using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Folio.Api.Auth;

namespace Folio.Api.Tests;

/// <summary>
/// Accounts over HTTP: signing in, the one-time password, the PIN, and the one thing that
/// matters most about any of it -- that one account cannot see another's budget.
///
/// Every test that changes a password works on an account of its own, because the class
/// shares one database and one fixture account.
/// </summary>
public sealed class AuthApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string NewPassword = "a-brand-new-password";

    private const string Ireland = "/api/folio/workspace?country=ireland";

    [DatabaseFact]
    public async Task The_budget_refuses_a_request_with_no_session()
    {
        var response = await factory.CreateClient().GetAsync(Ireland);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [DatabaseFact]
    public async Task Signing_in_with_the_wrong_password_is_refused()
    {
        var response = await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/signin",
            new { username = ApiFactory.Username, password = "not-the-password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [DatabaseFact]
    public async Task Signing_in_with_a_name_that_is_not_here_says_the_same_thing_as_a_wrong_password()
    {
        var response = await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/signin",
            new { username = "nobody-at-all", password = "not-the-password" });

        var wrong = await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/signin",
            new { username = ApiFactory.Username, password = "not-the-password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(
            await wrong.Content.ReadAsStringAsync(),
            await response.Content.ReadAsStringAsync());
    }

    [DatabaseFact]
    public async Task Signing_in_leaves_a_cookie_no_script_can_read_and_opens_the_budget()
    {
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/auth/signin",
            new { username = ApiFactory.Username, password = ApiFactory.Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var cookie = Assert.Single(response.Headers.GetValues("Set-Cookie"));
        Assert.Contains(SessionService.CookieName, cookie);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(Ireland)).StatusCode);
    }

    [DatabaseFact]
    public async Task Signing_out_ends_the_session_it_was_given()
    {
        var client = await factory.CreateSignedInClientAsync();

        var signedOut = await client.PostAsync("/api/auth/signout", null);
        Assert.Equal(HttpStatusCode.NoContent, signedOut.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(Ireland)).StatusCode);
    }

    [DatabaseFact]
    public async Task One_account_cannot_see_another_ones_budget()
    {
        var first = "first-" + Guid.NewGuid().ToString("N")[..8];
        var second = "second-" + Guid.NewGuid().ToString("N")[..8];

        factory.AddAccount(first, ApiFactory.Password);
        factory.AddAccount(second, ApiFactory.Password);

        var mine = await factory.CreateSignedInClientAsync(first, ApiFactory.Password);
        var theirs = await factory.CreateSignedInClientAsync(second, ApiFactory.Password);

        var saved = await mine.PutAsJsonAsync("/api/folio/transactions?country=ireland", new
        {
            transactions = new object[]
            {
                new
                {
                    id = 1,
                    name = "Only mine",
                    date = "2026-02-04",
                    createdAt = "2026-02-04T10:00:00.000Z",
                    amount = 12.50m,
                    type = "out",
                },
            },
            nextId = 2,
        });

        Assert.Equal(HttpStatusCode.NoContent, saved.StatusCode);

        // The other account's budget is its own, and it is empty.
        using var theirBody = JsonDocument.Parse(
            await (await theirs.GetAsync("/api/folio/workspace?country=ireland")).Content.ReadAsStringAsync());

        Assert.Empty(theirBody.RootElement.EnumerateObject());

        // ...and deleting the country leaves the account that owns it alone.
        Assert.Equal(HttpStatusCode.NoContent, (await theirs.DeleteAsync("/api/folio/workspace?country=ireland")).StatusCode);

        using var myBody = JsonDocument.Parse(
            await (await mine.GetAsync("/api/folio/workspace?country=ireland")).Content.ReadAsStringAsync());

        Assert.Equal(1, myBody.RootElement.GetProperty("folio_transactions").GetProperty("transactions").GetArrayLength());
    }

    [DatabaseFact]
    public async Task Settings_are_one_persons_own()
    {
        var other = "settings-" + Guid.NewGuid().ToString("N")[..8];

        factory.AddAccount(other, ApiFactory.Password);

        var theirs = await factory.CreateSignedInClientAsync(other, ApiFactory.Password);
        var mine = await factory.CreateSignedInClientAsync();

        var saved = await mine.PutAsJsonAsync("/api/folio/settings", new
        {
            theme = "midnight",
            locale = "en-IE",
            currency = "EUR",
            dateStyle = "medium",
            timeStyle = "24h",
            country = "ireland",
            billableMonthStart = 1,
        });

        Assert.Equal(HttpStatusCode.NoContent, saved.StatusCode);

        // The other account has saved nothing, so it is told there is nothing rather than
        // handed somebody else's preferences.
        Assert.Equal(HttpStatusCode.NoContent, (await theirs.GetAsync("/api/folio/settings")).StatusCode);

        var mineAgain = await mine.GetFromJsonAsync<JsonElement>("/api/folio/settings");
        Assert.Equal("midnight", mineAgain.GetProperty("theme").GetString());
    }

    [DatabaseFact]
    public async Task A_one_time_password_has_to_be_replaced_before_the_budget_answers()
    {
        var username = "otp-" + Guid.NewGuid().ToString("N")[..8];
        const string oneTime = "one-time-password";

        factory.AddAccount(username, oneTime, mustChangePassword: true);

        var client = await factory.CreateSignedInClientAsync(username, oneTime);

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(Ireland)).StatusCode);

        var changed = await client.PostAsJsonAsync("/api/auth/password", new
        {
            currentPassword = oneTime,
            newPassword = NewPassword,
        });

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(Ireland)).StatusCode);

        // The one that was handed over is gone, and the new one is the way in.
        var withOld = await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/signin",
            new { username, password = oneTime });

        Assert.Equal(HttpStatusCode.Unauthorized, withOld.StatusCode);

        var withNew = await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/signin",
            new { username, password = NewPassword });

        Assert.Equal(HttpStatusCode.OK, withNew.StatusCode);
    }

    [DatabaseFact]
    public async Task A_password_change_needs_the_current_one_and_signs_the_other_browsers_out()
    {
        var username = "change-" + Guid.NewGuid().ToString("N")[..8];

        factory.AddAccount(username, ApiFactory.Password);

        var here = await factory.CreateSignedInClientAsync(username, ApiFactory.Password);
        var elsewhere = await factory.CreateSignedInClientAsync(username, ApiFactory.Password);

        var wrong = await here.PostAsJsonAsync("/api/auth/password", new
        {
            currentPassword = "not-the-password",
            newPassword = NewPassword,
        });

        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);

        var changed = await here.PostAsJsonAsync("/api/auth/password", new
        {
            currentPassword = ApiFactory.Password,
            newPassword = NewPassword,
        });

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);

        // The browser that changed it keeps its session; the other one does not.
        Assert.Equal(HttpStatusCode.OK, (await here.GetAsync(Ireland)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await elsewhere.GetAsync(Ireland)).StatusCode);
    }

    [DatabaseFact]
    public async Task A_pin_resets_a_forgotten_password()
    {
        var username = "pin-" + Guid.NewGuid().ToString("N")[..8];

        factory.AddAccount(username, ApiFactory.Password);

        var client = await factory.CreateSignedInClientAsync(username, ApiFactory.Password);

        var set = await client.PostAsJsonAsync("/api/auth/pin", new
        {
            password = ApiFactory.Password,
            pin = "135790",
        });

        Assert.Equal(HttpStatusCode.OK, set.StatusCode);

        await client.PostAsync("/api/auth/signout", null);

        // A PIN is no use without the username, and the username is no use without the PIN.
        var wrongPin = await factory.CreateClient().PostAsJsonAsync("/api/auth/reset", new
        {
            username,
            pin = "000000",
            newPassword = NewPassword,
        });

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPin.StatusCode);

        var fresh = factory.CreateClient();
        var reset = await fresh.PostAsJsonAsync("/api/auth/reset", new
        {
            username,
            pin = "135790",
            newPassword = NewPassword,
        });

        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        // The reset signs in the browser that asked, and the new password is the one that works.
        Assert.Equal(HttpStatusCode.OK, (await fresh.GetAsync(Ireland)).StatusCode);

        var withNew = await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/signin",
            new { username, password = NewPassword });

        Assert.Equal(HttpStatusCode.OK, withNew.StatusCode);
    }

    [DatabaseFact]
    public async Task Enough_wrong_pins_buy_a_wait_rather_than_another_try()
    {
        var username = "lockout-" + Guid.NewGuid().ToString("N")[..8];

        factory.AddAccount(username, ApiFactory.Password);

        var client = await factory.CreateSignedInClientAsync(username, ApiFactory.Password);

        await client.PostAsJsonAsync("/api/auth/pin", new { password = ApiFactory.Password, pin = "135790" });
        await client.PostAsync("/api/auth/signout", null);

        for (var attempt = 0; attempt < AccountRules.PinAttemptsBeforeLockout; attempt++)
        {
            var wrong = await factory.CreateClient().PostAsJsonAsync("/api/auth/reset", new
            {
                username,
                pin = "000000",
                newPassword = NewPassword,
            });

            Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        }

        // The next one is answered with a wait, even though the PIN is right.
        var locked = await factory.CreateClient().PostAsJsonAsync("/api/auth/reset", new
        {
            username,
            pin = "135790",
            newPassword = NewPassword,
        });

        Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
    }
}

/// <summary>
/// The first account, on a site that has none: the one thing that happens once, from the
/// page rather than from the box. Each test makes its own site, because claiming is a
/// once-only act and a shared database would remember it.
/// </summary>
public sealed class FirstAccountApiTests
{
    [DatabaseFact]
    public async Task A_site_with_no_accounts_offers_to_make_the_first_one()
    {
        using var factory = new EmptyApiFactory();

        var state = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/auth/state");

        Assert.True(state.GetProperty("needsFirstAccount").GetBoolean());
        Assert.False(state.GetProperty("signedIn").GetBoolean());
    }

    [DatabaseFact]
    public async Task Claiming_it_is_the_only_one_that_can_be_made_from_the_page()
    {
        using var factory = new EmptyApiFactory();

        var client = factory.CreateClient();

        var claimed = await client.PostAsJsonAsync(
            "/api/auth/claim",
            new { username = "the-first", password = "the-first-password" });

        Assert.Equal(HttpStatusCode.OK, claimed.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/folio/workspace?country=ireland")).StatusCode);

        // A second attempt is answered with the way in rather than making a second account.
        var again = factory.CreateClient().PostAsJsonAsync(
            "/api/auth/claim",
            new { username = "another", password = "another-password" });

        Assert.Equal(HttpStatusCode.BadRequest, (await again).StatusCode);
    }
}
