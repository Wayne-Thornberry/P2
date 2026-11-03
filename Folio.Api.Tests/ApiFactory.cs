using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Hosting;
using Folio.Api.Modules.Core;

namespace Folio.Api.Tests;

/// <summary>
/// Boots the real API against its own throwaway database, so a test runs against the
/// same startup work the app does -- migrations applied to an empty database, the
/// account seeded -- without touching a database anyone is using. The database is
/// dropped when the factory is disposed, which is once per test class.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    public const string Username = "wayne";

    /// <summary>
    /// The seeded password. It is a fixed string in a test database that is created
    /// and dropped inside a run, so it is not a secret and does not pretend to be one.
    /// </summary>
    public const string Password = "test-password";

    /// <summary>
    /// The recovery code this API is configured with, for replacing a forgotten password
    /// without a session.
    /// </summary>
    public const string RecoveryCode = "test-recovery-code";

    private readonly string _databaseName = $"Folio_Tests_{Guid.NewGuid():N}";
    private bool _created;

    public ApiFactory()
    {
        // Starting the host is what runs the app's own startup work.
        _ = Services;
    }

    public string DatabaseName => _databaseName;

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
        builder.UseSetting("Auth:SeedUsername", Username);
        builder.UseSetting("Auth:SeedPassword", Password);
        builder.UseSetting("Auth:RecoveryCode", RecoveryCode);

        // The suite signs in more often than a person would ever try.
        builder.UseSetting("Auth:SignInAttemptsPerMinute", "1000");

        builder.UseEnvironment(Environments.Development);

        ConfigureSettings(builder);
    }

    /// <summary>Settings a subclass wants on top of these, for behaviour that depends on one.</summary>
    protected virtual void ConfigureSettings(IWebHostBuilder builder)
    {
    }

    /// <summary>A client carrying a session, as the browser would after signing in.</summary>
    public async Task<HttpClient> CreateSignedInClientAsync()
    {
        var client = CreateClient();

        var response = await client.PostAsJsonAsync("/api/core/auth/login", new { username = Username, password = Password });
        response.EnsureSuccessStatusCode();

        var session = await response.Content.ReadFromJsonAsync<SignInResponse>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session!.Token);

        return client;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);

        if (disposing && _created)
            TestDatabase.Drop(TestDatabase.Server, _databaseName);
    }
}
