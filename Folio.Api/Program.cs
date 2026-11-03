using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;
using Folio.Api.Http;
using Folio.Api.Modules;
using Folio.Api.Modules.Core;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException(
        "ConnectionStrings:Default is not configured, so there is no database to serve from. "
        + "A local run has no database: the site talks to the mock in Folio.Web\\mocks, started by start.ps1. "
        + "To run this API instead, put a connection string in appsettings.Development.json and use start.ps1 -Api.");

// SQL Server is the real database. The app never creates the schema: the model in
// Folio.Database does, and the deploy publishes it before starting this app.
builder.Services.AddDbContext<FolioDbContext>(options => options.UseSqlServer(connectionString));

// A field the site never set is written as an absent property rather than an explicit
// null, because the site distinguishes "never set" from false and from zero.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull);

// Every module in the assembly, found rather than listed, so copying a module into
// the repository is all it takes for it to be registered and served.
var catalog = ModuleCatalog.Discover();
builder.Services.AddSingleton(catalog);

foreach (var module in catalog.Modules)
    module.AddServices(builder.Services, builder.Configuration);

// The portal and its modules are one origin, and the API is another, so the browser
// needs CORS. In development the portal is on a loopback address; in production it is
// whatever the site is reached by, which the deploy writes into
// Cors:AllowedOrigins. Loopback and private addresses are always allowed because a
// home server is reached by all of them at different times.
var configuredOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];

static bool IsPrivateHost(string host) =>
    host is "localhost" or "127.0.0.1" or "::1"
    || host.StartsWith("192.168.", StringComparison.Ordinal)
    || host.StartsWith("10.", StringComparison.Ordinal)
    || (host.StartsWith("172.", StringComparison.Ordinal)
        && int.TryParse(host.Split('.')[1], out var second)
        && second is >= 16 and <= 31);

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        // Nothing here rides on a cookie the browser would send by itself, so the origin
        // may be allowed without credentials.
        policy.SetIsOriginAllowed(origin =>
                  configuredOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase)
                  || (Uri.TryCreate(origin, UriKind.Absolute, out var uri) && IsPrivateHost(uri.Host)))
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();

// Routing first, so an endpoint is known before anything else looks at the request.
app.UseRouting();

app.UseCors();

// Anything a module throws still has to answer in the shape the client reads.
// Without this the browser gets a bare 500 it cannot parse and the reason never
// reaches the log.
app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
{
    var error = context.Features.Get<IExceptionHandlerFeature>()?.Error;

    context.RequestServices
        .GetRequiredService<ILoggerFactory>()
        .CreateLogger("Folio.Unhandled")
        .LogError(error, "Unhandled exception answering {Method} {Path}.",
            context.Request.Method, context.Request.Path);

    // A throw here is a bug: say so, and keep the detail in the log rather than on
    // the wire.
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    await context.Response.WriteAsJsonAsync(new ErrorBody("Something went wrong. Nothing was changed."));
}));

app.MapGet("/api/health", HealthEndpoints.GetAsync);

var api = app.MapGroup("/api");
foreach (var module in catalog.Modules)
    module.Map(api.MapGroup("/" + module.Name));

app.Run();

/// <summary>The app itself, so the tests can start it in-process with WebApplicationFactory.</summary>
public partial class Program;
