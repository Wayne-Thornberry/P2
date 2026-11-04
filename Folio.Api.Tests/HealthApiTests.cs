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

        // The same three headers Folio.Web's web.config puts on the site's files, because
        // an old proxy reads Pragma and Expires and nothing else. "0" is not a date, and
        // that is the point: it is the convention for a date already gone.
        Assert.Equal("no-cache", response.Headers.Pragma.ToString());

        Assert.True(response.Content.Headers.TryGetValues("Expires", out var expires), "Expires must be sent");
        Assert.Equal("0", expires.Single());
    }

    [Fact]
    public async Task Every_answer_says_so_not_only_the_health_check()
    {
        // One middleware, not a line on each endpoint: a path nothing serves and a request
        // that has to sign in first carry it too.
        var client = factory.CreateClient();

        foreach (var path in new[] { "/api/nothing-here", "/api/folio/workspace?country=ireland" })
        {
            var response = await client.GetAsync(path);

            Assert.True(response.Headers.CacheControl?.NoStore, $"{path} must not be stored");
            Assert.True(response.Headers.CacheControl?.NoCache, $"{path} must be revalidated");

            Assert.True(response.Content.Headers.TryGetValues("Expires", out var expires), $"{path} must say Expires");
            Assert.Equal("0", expires.Single());
        }
    }
}
