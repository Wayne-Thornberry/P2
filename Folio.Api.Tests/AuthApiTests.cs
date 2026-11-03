using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Folio.Api.Modules.Core;

namespace Folio.Api.Tests;

/// <summary>
/// Everything about signing in. This is the only door into the API, so it is the one
/// that gets tested from every side.
/// </summary>
public sealed class AuthApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [DatabaseFact]
    public async Task The_api_refuses_a_request_that_carries_no_token()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/core/modules");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("Not signed in.", await ErrorOf(response));
    }

    [DatabaseFact]
    public async Task A_wrong_password_is_refused_without_saying_which_half_was_wrong()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/core/auth/login",
            new { username = ApiFactory.Username, password = "not-the-password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("That username and password do not match an account.", await ErrorOf(response));
    }

    [DatabaseFact]
    public async Task An_unknown_username_gets_the_same_answer_as_a_wrong_password()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/core/auth/login",
            new { username = "nobody", password = ApiFactory.Password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("That username and password do not match an account.", await ErrorOf(response));
    }

    [DatabaseFact]
    public async Task Signing_in_returns_a_token_that_opens_the_api()
    {
        var client = await factory.CreateSignedInClientAsync();

        var me = await client.GetFromJsonAsync<MeResponse>("/api/core/auth/me");

        Assert.Equal(ApiFactory.Username, me!.Username);
    }

    [DatabaseFact]
    public async Task Signing_out_forgets_the_token()
    {
        var client = await factory.CreateSignedInClientAsync();

        var signOut = await client.PostAsync("/api/core/auth/logout", content: null);
        Assert.Equal(HttpStatusCode.NoContent, signOut.StatusCode);

        var me = await client.GetAsync("/api/core/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
    }

    [DatabaseFact]
    public async Task Signing_in_with_nothing_is_a_bad_request()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/core/auth/login", new { username = " ", password = "" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("A username and a password are needed.", await ErrorOf(response));
    }

    [DatabaseFact]
    public async Task A_token_that_was_never_issued_is_refused()
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", "not-a-real-token");

        var response = await client.GetAsync("/api/core/auth/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    private static async Task<string?> ErrorOf(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        return body.TryGetProperty("error", out var error) ? error.GetString() : null;
    }
}
