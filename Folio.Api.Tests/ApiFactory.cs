using System.Net.Http.Json;
using Folio.Api.Auth;
using Folio.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Folio.Api.Tests;

/// <summary>
/// Boots the real API against its own throwaway database, so a test runs against the
/// same startup work the app does -- the schema built from the model, then read as a
/// real deployment would -- without touching a database anyone is using. The database is
/// dropped when the factory is disposed, which is once per test class.
///
/// Every client it hands out has signed in, because the budget answers 401 to anyone who
/// has not: a test that is about the budget is not a test about signing in.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    /// <summary>The account every test signs in as unless it says otherwise.</summary>
    public const string Username = "tester";

    public const string Password = "test-password";

    private readonly bool _seed;
    private readonly string _databaseName = $"Folio_Tests_{Guid.NewGuid():N}";
    private bool _created;

    /// <summary>Everything signs in as one fixture account, except the tests about making the first one.</summary>
    public ApiFactory()
        : this(seed: true)
    {
    }

    // Not public: xUnit insists a class fixture has one constructor, and the switch is only
    // for the tests that start a site with no accounts at all.
    internal ApiFactory(bool seed)
    {
        _seed = seed;

        // Starting the host is what runs the app's own startup work.
        _ = Services;

        // The budget is behind a sign-in now, so there has to be somebody to sign in as.
        // Written straight into the database rather than through the API: the account is a
        // fixture, not the thing under test.
        if (_created && _seed)
            AddAccount(Username, Password);
    }

    public string DatabaseName => _databaseName;

    /// <summary>An account made directly, for the tests that need more than one.</summary>
    public void AddAccount(string username, string password, bool mustChangePassword = false)
    {
        using var scope = Services.CreateScope();

        var db = scope.ServiceProvider.GetRequiredService<FolioDbContext>();
        var (hash, salt) = SecretHasher.Hash(password);
        var now = DateTime.UtcNow;

        db.AuthUsers.Add(new AuthUser
        {
            Username = username,
            PasswordHash = hash,
            PasswordSalt = salt,
            MustChangePassword = mustChangePassword,
            ClaimedAt = now,
            CreatedAt = now,
        });

        db.SaveChanges();
    }

    /// <summary>A client that has signed in as the fixture's account.</summary>
    public Task<HttpClient> CreateSignedInClientAsync() =>
        CreateSignedInClientAsync(Username, Password);

    public async Task<HttpClient> CreateSignedInClientAsync(string username, string password)
    {
        // The default client keeps the session cookie, which is the whole of what a
        // signed-in client is.
        var client = CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/signin", new { username, password });

        response.EnsureSuccessStatusCode();

        return client;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // With nowhere to build a database, the host is left pointing at nothing: every
        // test that would use it is skipped, and a fixture that threw here would turn a
        // skip into a failure.
        if (TestDatabase.SkipReason is null)
            TestDatabase.Create(TestDatabase.Server, _databaseName);
        else
            return;

        _created = true;

        builder.UseSetting("ConnectionStrings:Default", TestDatabase.ConnectionString(TestDatabase.Server, _databaseName));

        builder.UseEnvironment(Environments.Development);

        ConfigureSettings(builder);
    }

    /// <summary>Settings a subclass wants on top of these, for behaviour that depends on one.</summary>
    protected virtual void ConfigureSettings(IWebHostBuilder builder)
    {
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);

        if (disposing && _created)
            TestDatabase.Drop(TestDatabase.Server, _databaseName);
    }
}

/// <summary>
/// A site that has never had an account, which is the only state the first-account page is
/// offered in. Made by hand in that one test rather than as a class fixture.
/// </summary>
public sealed class EmptyApiFactory() : ApiFactory(seed: false);
