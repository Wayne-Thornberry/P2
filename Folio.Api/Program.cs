using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;
using Folio.Api.Http;
using Folio.Api.Modules;

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

// A module that works something out for the site takes TimeProvider rather than reading the
// clock itself, so a test can stand at a fixed day.
builder.Services.AddSingleton(TimeProvider.System);

// Every module in the assembly, found rather than listed, so copying a module into
// the repository is all it takes for it to be registered and served.
var catalog = ModuleCatalog.Discover();
builder.Services.AddSingleton(catalog);

foreach (var module in catalog.Modules)
    module.AddServices(builder.Services, builder.Configuration);

// The site and the API are one origin apart, so the browser needs CORS. Which origins are
// allowed is a rule of its own (Http/Origins.cs): the one the deploy names, and any
// private address, because a home server is reached by all of them at different times.
var configuredOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        // Nothing here rides on a cookie the browser would send by itself, so the origin
        // may be allowed without credentials.
        policy.SetIsOriginAllowed(origin => Origins.IsAllowed(origin, configuredOrigins))
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();

// Routing first, so an endpoint is known before anything else looks at the request.
app.UseRouting();

app.UseCors();

// Anything a module throws still has to answer in the shape the client reads.
app.UseFolioErrors();

app.MapGet("/api/health", HealthEndpoints.GetAsync);

var api = app.MapGroup("/api");
foreach (var module in catalog.Modules)
    module.Map(api.MapGroup("/" + module.Name));

app.Run();

/// <summary>The app itself, so the tests can start it in-process with WebApplicationFactory.</summary>
public partial class Program;
