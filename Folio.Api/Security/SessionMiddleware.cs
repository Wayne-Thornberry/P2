using Microsoft.AspNetCore.Authorization;
using Folio.Api.Http;

namespace Folio.Api.Security;

/// <summary>
/// Decides who is calling, before any endpoint runs.
///
/// An endpoint needs a session unless it says <c>AllowAnonymous()</c>. Refusing by
/// default is the point: a module's new endpoint is protected because nobody did
/// anything, rather than open because somebody forgot.
///
/// The account is put on the request, so an endpoint reads it with
/// <c>HttpContext.GetUser()</c> and never has to parse a token itself.
/// </summary>
public sealed class SessionMiddleware(RequestDelegate next)
{
    private const string BearerPrefix = "Bearer ";

    public async Task InvokeAsync(HttpContext context, Modules.Core.SessionService sessions)
    {
        if (IsOpen(context))
        {
            await next(context);
            return;
        }

        var token = BearerToken(context.Request);
        var user = token is null ? null : await sessions.ValidateAsync(token, context.RequestAborted);

        if (user is null)
        {
            await ApiErrors.Unauthorized("Not signed in.").ExecuteAsync(context);
            return;
        }

        context.SetUser(user);
        await next(context);
    }

    /// <summary>The token a request carries, or null when it carries none.</summary>
    public static string? BearerToken(HttpRequest request)
    {
        var header = request.Headers.Authorization.ToString();

        if (!header.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase))
            return null;

        var token = header[BearerPrefix.Length..].Trim();

        return token.Length == 0 ? null : token;
    }

    /// <summary>
    /// Whether this request has no endpoint to run, or an endpoint that asked to be
    /// open. Anything that is not <c>/api</c> is left alone: nothing else is served.
    /// </summary>
    private static bool IsOpen(HttpContext context) =>
        context.GetEndpoint() is not { } endpoint
        || endpoint.Metadata.GetMetadata<AllowAnonymousAttribute>() is not null
        || !context.Request.Path.StartsWithSegments("/api", StringComparison.OrdinalIgnoreCase);
}
