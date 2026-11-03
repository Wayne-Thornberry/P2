namespace Folio.Api.Http;

/// <summary>
/// The one shape a failure takes on the wire: <c>{ "error": "why" }</c>. Every
/// module answers with this, so the shared client can read the reason off any
/// refusal without knowing which endpoint produced it.
/// </summary>
public static class ApiErrors
{
    public static IResult BadRequest(string message) => Of(message, StatusCodes.Status400BadRequest);

    public static IResult Of(string message, int statusCode) =>
        Results.Json(new ErrorBody(message), statusCode: statusCode);
}

public sealed record ErrorBody(string Error);
