using Folio.Api.Data;

namespace Folio.Api.Http;

/// <summary>
/// Whether the API can serve anything at all: it is up, but everything it does needs
/// the database, so this says whether that is reachable.
///
/// It is what the deploy's smoke test asks, and it says nothing about the data.
/// </summary>
internal static class HealthEndpoints
{
    public static async Task<IResult> GetAsync(FolioDbContext db, CancellationToken cancellationToken)
    {
        var reachable = await db.Database.CanConnectAsync(cancellationToken);

        var body = new HealthResponse(
            reachable ? "ok" : "unreachable",
            reachable ? "ok" : "unreachable");

        return Results.Json(body, statusCode: reachable ? StatusCodes.Status200OK : StatusCodes.Status503ServiceUnavailable);
    }
}

public sealed record HealthResponse(string Status, string Database);
