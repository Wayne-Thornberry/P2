using System.Net;
using System.Net.Http.Json;
using Folio.Api.Http;

namespace Folio.Api.Tests;

/// <summary>
/// The health endpoint is what the deploy's smoke test asks, so it has to answer on its
/// own: whether the API is up and whether the database behind it is reachable.
/// </summary>
public sealed class HealthApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [DatabaseFact]
    public async Task Health_answers_and_reports_the_database()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<HealthResponse>();

        Assert.Equal("ok", body!.Status);
        Assert.Equal("ok", body.Database);
    }

    [DatabaseFact]
    public async Task The_answer_is_not_to_be_kept()
    {
        // Nothing between the box and the browser may keep an answer: what the API works
        // out changes when a button is pressed, and a cached one describes a budget that
        // has moved on.
        var response = await factory.CreateClient().GetAsync("/api/health");

        Assert.True(response.Headers.CacheControl?.NoStore);
        Assert.True(response.Headers.CacheControl?.NoCache);
    }
}
