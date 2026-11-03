using System.Net;
using System.Net.Http.Json;
using Folio.Api.Modules.Core;

namespace Folio.Api.Tests;

/// <summary>
/// The health endpoint is what the deploy's smoke test asks, so it has to answer
/// without a session and say whether the database is reachable.
/// </summary>
public sealed class HealthApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [DatabaseFact]
    public async Task Health_answers_without_a_token_and_reports_the_database()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<HealthResponse>();

        Assert.Equal("ok", body!.Status);
        Assert.Equal("ok", body.Database);
    }
}
