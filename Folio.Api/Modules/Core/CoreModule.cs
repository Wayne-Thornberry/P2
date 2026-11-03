using Folio.Api.Http;

namespace Folio.Api.Modules.Core;

/// <summary>
/// Signing in, and the list of apps the site offers.
///
/// This is the only module with no page of its own: the sign-in screen at <c>/login</c>
/// is Core's face, because signing in and knowing what the site has are the same job.
/// </summary>
public sealed class CoreModule : IFolioModule
{
    public const string ModuleName = "core";

    /// <summary>The schema this module's tables live in. A script in Folio.Database creates it.</summary>
    public const string SchemaName = "core";

    /// <summary>The rate limiter that protects the only endpoint a stranger can reach.</summary>
    public const string SignInRateLimitPolicy = "sign-in";

    public string Name => ModuleName;

    public string Title => "This site";

    public string Description => "The account everything else is signed in with.";

    public void AddServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<PasswordHasher>();
        services.AddScoped<SessionService>();
        services.Configure<AuthOptions>(configuration.GetSection(AuthOptions.SectionName));
    }

    public void Map(RouteGroupBuilder api)
    {
        var auth = api.MapGroup("/auth");

        // The password is the only way in without a session, so it is the only place
        // a guess costs nothing. Everything else already needs a token.
        auth.MapPost("/login", AuthEndpoints.SignInAsync)
            .AllowAnonymous()
            .RequireRateLimiting(SignInRateLimitPolicy);

        auth.MapPost("/logout", AuthEndpoints.SignOutAsync);
        auth.MapGet("/me", AuthEndpoints.Me);

        // Signed in, and changing the password you know.
        auth.MapPost("/change-password", AuthEndpoints.ChangePasswordAsync);

        // Not signed in, and replacing the password you have forgotten. Rate-limited like
        // sign-in, because it is the other endpoint a stranger can reach for free.
        auth.MapPost("/reset-password", AuthEndpoints.ResetPasswordAsync)
            .AllowAnonymous()
            .RequireRateLimiting(SignInRateLimitPolicy);

        api.MapGet("/modules", (ModuleCatalog catalog) => Results.Ok(catalog.Summaries()));
    }
}
