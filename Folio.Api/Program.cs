using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;
using Folio.Api.Http;
using Folio.Api.Modules;
using Folio.Api.Modules.Core;
using Folio.Api.Security;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException(
        "ConnectionStrings:Default is not configured, so there is no database to serve from.");

// SQL Server is the real database. The app never creates the schema: the numbered
// scripts in Folio.Database do, and the deploy applies them before starting this app.
builder.Services.AddDbContext<FolioDbContext>(options => options.UseSqlServer(connectionString));

// A field the site never set is written as an absent property rather than an explicit
// null, because the site distinguishes "never set" from false and from zero.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull);

// Sessions expire against this clock, so a test can move time instead of waiting.
builder.Services.AddSingleton(TimeProvider.System);

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
        // Tokens travel in the Authorization header, not cookies, so the origin may be
        // allowed without credentials: nothing here rides on a cookie the browser
        // would send by itself.
        policy.SetIsOriginAllowed(origin =>
                  configuredOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase)
                  || (Uri.TryCreate(origin, UriKind.Absolute, out var uri) && IsPrivateHost(uri.Host)))
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// Signing in is the only way in without a session, so it is the only place a guess
// costs nothing: one caller gets a handful of tries a minute. The refusal is the
// app's own error shape, so the sign-in screen can say what happened.
var authSettings = builder.Configuration.GetSection(AuthOptions.SectionName).Get<AuthOptions>() ?? new AuthOptions();

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    options.AddPolicy(CoreModule.SignInRateLimitPolicy, context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = authSettings.SignInAttemptsPerMinute,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
            }));

    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        await context.HttpContext.Response.WriteAsJsonAsync(
            new ErrorBody("Too many sign-in attempts. Wait a minute and try again."),
            cancellationToken);
    };
});

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    await SeedAccount.RunAsync(scope.ServiceProvider, app.Logger);
}

// Routing first, so the session middleware can see which endpoint is about to run
// and whether it asked to be open.
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

app.UseRateLimiter();

// Who is calling, for everything under /api that did not ask to be open.
app.UseMiddleware<SessionMiddleware>();

app.MapGet("/api/health", HealthEndpoints.GetAsync).AllowAnonymous();

var api = app.MapGroup("/api");
foreach (var module in catalog.Modules)
    module.Map(api.MapGroup("/" + module.Name));

app.Run();

/// <summary>The app itself, so the tests can start it in-process with WebApplicationFactory.</summary>
public partial class Program;
