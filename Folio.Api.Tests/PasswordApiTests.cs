using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Folio.Api.Modules.Core;

namespace Folio.Api.Tests;

/// <summary>
/// Changing a password you know, and replacing one you don't.
///
/// The rule both share: every session dies, and the caller gets a fresh one back. A changed
/// password that leaves an old token working has not changed anything.
///
/// Each test builds its own factory, so each gets its own database: these tests change the
/// password, which would otherwise leave the rest of a shared fixture unable to sign in.
/// </summary>
public sealed class PasswordApiTests
{
    private const string NewPassword = "a-brand-new-password";

    [DatabaseFact]
    public async Task Changing_the_password_keeps_this_browser_in_and_puts_the_others_out()
    {
        using var factory = new ApiFactory();

        var client = await factory.CreateSignedInClientAsync();

        // A second browser, signed in as the same person.
        var other = await factory.CreateSignedInClientAsync();

        var response = await client.PostAsJsonAsync(
            "/api/core/auth/change-password",
            new { currentPassword = ApiFactory.Password, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var issued = await response.Content.ReadFromJsonAsync<SignInResponse>();

        // The caller carries on with the token it was handed...
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", issued!.Token);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/core/auth/me")).StatusCode);

        // ...and the other browser is signed out.
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.GetAsync("/api/core/auth/me")).StatusCode);
    }

    [DatabaseFact]
    public async Task The_new_password_is_the_one_that_signs_in()
    {
        using var factory = new ApiFactory();

        var client = await factory.CreateSignedInClientAsync();
        await client.PostAsJsonAsync(
            "/api/core/auth/change-password",
            new { currentPassword = ApiFactory.Password, newPassword = NewPassword });

        var anonymous = factory.CreateClient();

        var oldPassword = await anonymous.PostAsJsonAsync(
            "/api/core/auth/login",
            new { username = ApiFactory.Username, password = ApiFactory.Password });

        var newPassword = await anonymous.PostAsJsonAsync(
            "/api/core/auth/login",
            new { username = ApiFactory.Username, password = NewPassword });

        Assert.Equal(HttpStatusCode.Unauthorized, oldPassword.StatusCode);
        Assert.Equal(HttpStatusCode.OK, newPassword.StatusCode);
    }

    [DatabaseFact]
    public async Task The_wrong_current_password_changes_nothing()
    {
        using var factory = new ApiFactory();
        var client = await factory.CreateSignedInClientAsync();

        var response = await client.PostAsJsonAsync(
            "/api/core/auth/change-password",
            new { currentPassword = "not-the-password", newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        // Still signed in, because nothing happened.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/core/auth/me")).StatusCode);
    }

    [DatabaseFact]
    public async Task A_new_password_has_to_be_long_enough()
    {
        using var factory = new ApiFactory();
        var client = await factory.CreateSignedInClientAsync();

        var response = await client.PostAsJsonAsync(
            "/api/core/auth/change-password",
            new { currentPassword = ApiFactory.Password, newPassword = "short" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(PasswordPolicy.MinLength.ToString(), await response.Content.ReadAsStringAsync());
    }

    [DatabaseFact]
    public async Task Changing_the_password_needs_a_session()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/core/auth/change-password",
            new { currentPassword = ApiFactory.Password, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [DatabaseFact]
    public async Task The_recovery_code_replaces_a_forgotten_password()
    {
        using var factory = new ApiFactory();

        var signedIn = await factory.CreateSignedInClientAsync();
        var anonymous = factory.CreateClient();

        var response = await anonymous.PostAsJsonAsync(
            "/api/core/auth/reset-password",
            new { username = ApiFactory.Username, recoveryCode = ApiFactory.RecoveryCode, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        // The old sessions are gone...
        Assert.Equal(HttpStatusCode.Unauthorized, (await signedIn.GetAsync("/api/core/auth/me")).StatusCode);

        // ...and the new password signs in.
        var signIn = await anonymous.PostAsJsonAsync(
            "/api/core/auth/login",
            new { username = ApiFactory.Username, password = NewPassword });

        Assert.Equal(HttpStatusCode.OK, signIn.StatusCode);
    }

    [DatabaseFact]
    public async Task A_wrong_recovery_code_says_nothing_about_whether_the_account_exists()
    {
        using var factory = new ApiFactory();
        var client = factory.CreateClient();

        var wrongCode = await client.PostAsJsonAsync(
            "/api/core/auth/reset-password",
            new { username = ApiFactory.Username, recoveryCode = "not-the-code", newPassword = NewPassword });

        var unknownUser = await client.PostAsJsonAsync(
            "/api/core/auth/reset-password",
            new { username = "nobody", recoveryCode = "not-the-code", newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.Unauthorized, wrongCode.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownUser.StatusCode);
        Assert.Equal(await wrongCode.Content.ReadAsStringAsync(), await unknownUser.Content.ReadAsStringAsync());
    }

    [DatabaseFact]
    public async Task A_site_with_no_recovery_code_says_so_rather_than_refusing()
    {
        // The safe default: with nothing configured, a password cannot be replaced from
        // outside at all.
        using var factory = new NoRecoveryCodeApiFactory();
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/core/auth/reset-password",
            new { username = ApiFactory.Username, recoveryCode = "", newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Contains("No recovery code", await response.Content.ReadAsStringAsync());
    }
}

/// <summary>The same API, with no recovery code configured.</summary>
public sealed class NoRecoveryCodeApiFactory : ApiFactory
{
    protected override void ConfigureSettings(IWebHostBuilder builder) =>
        builder.UseSetting("Auth:RecoveryCode", "");
}
