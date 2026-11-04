using Microsoft.EntityFrameworkCore;
using Folio.Api.Auth;
using Folio.Api.Data;
using Folio.Api.Http;
using Folio.Api.Modules;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException(
        "ConnectionStrings:Default is not configured, so there is no database to serve from. "
        + "start.ps1 builds one in LocalDB, and the deploy writes a real one on the box.");

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

// Who is asking, and how they proved it. The current account is per request; the two
// services behind it are per scope so they share the one DbContext.
builder.Services.AddScoped<CurrentUser>();
builder.Services.AddScoped<SessionService>();
builder.Services.AddScoped<AccountService>();

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
        // The session is a cookie, so the browser has to be allowed to send it with a
        // request from another origin -- and a policy that carries credentials cannot
        // answer with a wildcard, which is why the origins are named rather than starred.
        policy.SetIsOriginAllowed(origin => Origins.IsAllowed(origin, configuredOrigins))
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

var app = builder.Build();

// Nothing this answers is to be kept by whatever sits between here and the person reading
// it. The list changes when a button is pressed, and an answered-from-cache page is a page
// describing a box that has moved on -- which is a bug report about the app, not the cache.
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
    context.Response.Headers.Pragma = "no-cache";

    await next();
});

// Routing first, so an endpoint is known before anything else looks at the request.
app.UseRouting();

// Who is asking, before anything answers: the session cookie is read here, once, and the
// endpoints behind the filter find the account already worked out. A request with no
// cookie costs nothing -- there is nothing to look up.
app.Use(async (context, next) =>
{
    var token = context.Request.Cookies[SessionService.CookieName];

    if (!string.IsNullOrEmpty(token))
    {
        var sessions = context.RequestServices.GetRequiredService<SessionService>();
        var user = await sessions.ResolveAsync(token, context.RequestAborted);

        if (user is not null)
            context.RequestServices.GetRequiredService<CurrentUser>().Adopt(user);
    }

    await next();
});

app.UseCors();

// Anything a module throws still has to answer in the shape the client reads.
app.UseFolioErrors();

app.MapGet("/api/health", HealthEndpoints.GetAsync);

// Signing in has to be reachable while signed out; everything else on the site does not.
AuthEndpoints.Map(app.MapGroup("/api/auth"));

// One filter for the whole budget: an endpoint added without a thought about accounts is
// behind them by not having said otherwise.
var api = app.MapGroup("/api").AddEndpointFilter<SignedInFilter>();
foreach (var module in catalog.Modules)
    module.Map(api.MapGroup("/" + module.Name));

// Making an account is the box's job, not the site's: `--add-user <name>` prints a
// one-time password and exits before the server starts.
if (args is [AddUserCommand.Switch, var username, ..])
{
    using var scope = app.Services.CreateScope();

    return await AddUserCommand.RunAsync(scope.ServiceProvider, username);
}

app.Run();

return 0;

/// <summary>The app itself, so the tests can start it in-process with WebApplicationFactory.</summary>
public partial class Program;
