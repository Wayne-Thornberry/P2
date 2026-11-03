using Microsoft.AspNetCore.Mvc;

namespace Folio.Api.Http;

/// <summary>
/// The one shape a failure takes on the wire: <c>{ "error": "why" }</c>. Every
/// module answers with this, so the shared client can read the reason off any
/// refusal without knowing which endpoint produced it.
/// </summary>
public static class ApiErrors
{
    public static IResult BadRequest(string message) => Of(message, StatusCodes.Status400BadRequest);

    public static IResult Unauthorized(string message) => Of(message, StatusCodes.Status401Unauthorized);

    public static IResult NotFound(string message) => Of(message, StatusCodes.Status404NotFound);

    public static IResult Of(string message, int statusCode) =>
        Results.Json(new ErrorBody(message), statusCode: statusCode);
}

public sealed record ErrorBody(string Error);

/// <summary>
/// The signed-in account behind the request, put there by the session middleware
/// after it has checked the token. An endpoint only runs when this exists.
/// </summary>
public sealed record AuthenticatedUser(int Id, string Username);

public static class HttpContextUserExtensions
{
    private const string ItemKey = "Folio.user";

    public static void SetUser(this HttpContext context, AuthenticatedUser user) => context.Items[ItemKey] = user;

    /// <summary>The signed-in account. Throws if called from an endpoint that is open to the world.</summary>
    public static AuthenticatedUser GetUser(this HttpContext context) =>
        context.Items[ItemKey] as AuthenticatedUser
        ?? throw new InvalidOperationException(
            "This endpoint has no signed-in account. It is either anonymous or on a path the session middleware skipped.");
}
