using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Hosting;

namespace Folio.Api.Tests;

/// <summary>
/// Boots the real API against its own throwaway database, so a test runs against the
/// same startup work the app does -- the schema built from the model, then read as a
/// real deployment would -- without touching a database anyone is using. The database is
/// dropped when the factory is disposed, which is once per test class.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>
{
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

        builder.UseEnvironment(Environments.Development);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);

        if (disposing && _created)
            TestDatabase.Drop(TestDatabase.Server, _databaseName);
    }
}
