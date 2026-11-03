using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace Folio.Api.Tests;

/// <summary>
/// Builds and drops the throwaway SQL Server database a test class runs against.
///
/// The database is built from Folio.Database's own scripts -- Schemas, Types, Tables,
/// PostDeployment -- so a test never runs against a schema somebody imagined: it runs
/// against the one a fresh deployment produces. The numbered migrations are then applied
/// on top, which is what proves they still land a database where the model says it
/// should be.
///
/// This is the same work <c>scripts\Database.ps1</c> does for a developer's machine, in
/// C# rather than PowerShell because the tests are where it has to happen.
/// </summary>
internal static class TestDatabase
{
    /// <summary>Where the database project's scripts land in the test output.</summary>
    private static readonly string ScriptsRoot = Path.Combine(AppContext.BaseDirectory, "Schema");

    /// <summary>
    /// Where test databases are created.
    ///
    /// The default is the LocalDB instance <c>start.ps1</c> creates, because that is the
    /// one a laptop has. The deploy overrides it with a server whose account may create
    /// databases.
    /// </summary>
    public static readonly string Server =
        Environment.GetEnvironmentVariable("Folio_TEST_SQL_SERVER") is { Length: > 0 } configured
            ? configured
            : @"(localdb)\Folio";

    /// <summary>
    /// Whether a database can be created here. Checked once, so a suite on a machine with
    /// no SQL Server reports skipped tests with one reason rather than a connection error
    /// per class.
    /// </summary>
    public static readonly bool Available = Probe();

    /// <summary>Why the database tests cannot run here, or empty when they can.</summary>
    public static readonly string UnavailableReason = Available ? "" : DescribeFailure();

    /// <summary>
    /// Whether a suite that could not reach a database should fail instead of skipping.
    /// The deploy sets this, because a deploy whose tests silently skipped is a deploy
    /// nothing checked.
    /// </summary>
    private static readonly bool MustRun =
        Environment.GetEnvironmentVariable("Folio_REQUIRE_DATABASE_TESTS") == "1";

    /// <summary>The reason a test that needs a database is skipped, or null when it is not.</summary>
    internal static string? SkipReason => Available ? null : MustRun ? null : UnavailableReason;

    /// <summary>
    /// A connection to one database on the server under test. <paramref name="server"/>
    /// may be a server name, as <c>Folio_TEST_SQL_SERVER</c> normally is, or a whole
    /// connection string whose credentials are then kept.
    /// </summary>
    public static string ConnectionString(string server, string database) =>
        new SqlConnectionStringBuilder(Builder(server).ConnectionString) { InitialCatalog = database }.ConnectionString;

    /// <summary>Creates the database, empty, builds it from the model scripts, and migrates it.</summary>
    public static void Create(string server, string database)
    {
        var connectionString = ConnectionString(server, database);

        CreateDatabase(connectionString, database);

        using var connection = Open(connectionString);

        // In dependency order: a schema before anything in it, a type before a table
        // declared in terms of it.
        foreach (var script in ScriptsIn("Schemas"))
            Run(connection, script);

        foreach (var script in ScriptsIn("Types"))
            Run(connection, script);

        ApplyTables(connection);

        Run(connection, Path.Combine(ScriptsRoot, "PostDeployment.sql"));

        ApplyMigrations(connection);
    }

    /// <summary>
    /// Applies the numbered migrations. They are idempotent and run on every deploy, so a
    /// database built from the model should be unchanged by them.
    /// </summary>
    public static void ApplyMigrations(string connectionString)
    {
        using var connection = Open(connectionString);
        ApplyMigrations(connection);
    }

    public static void Drop(string server, string database)
    {
        // The app's pooled connections keep a handle on the database, and a database
        // cannot be dropped while one is open.
        SqlConnection.ClearAllPools();

        var master = new SqlConnectionStringBuilder(ConnectionString(server, database)) { InitialCatalog = "master" }
            .ConnectionString;

        try
        {
            Execute(master, $"""
                IF DB_ID(N'{database}') IS NOT NULL
                BEGIN
                    ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
                    DROP DATABASE [{database}];
                END
                """);
        }
        catch (InvalidOperationException)
        {
            // A database that was never created is not worth failing a test run over.
        }
    }

    /// <summary>
    /// The table scripts are named after the tables, not the order they can be created
    /// in, and every foreign key needs the table it points at to exist first. Anything
    /// that fails waits for the next pass, so a table that is merely early sorts itself
    /// out; a pass where nothing succeeds means the failure is real.
    /// </summary>
    private static void ApplyTables(SqlConnection connection)
    {
        var pending = ScriptsIn("Tables").ToList();

        while (pending.Count > 0)
        {
            var deferred = new List<string>();
            SqlException? failure = null;

            foreach (var script in pending)
            {
                try
                {
                    Run(connection, script);
                }
                catch (SqlException ex)
                {
                    deferred.Add(script);
                    failure = ex;
                }
            }

            if (deferred.Count == pending.Count)
                throw failure!;

            pending = deferred;
        }
    }

    private static void ApplyMigrations(SqlConnection connection)
    {
        foreach (var script in ScriptsIn("Migrations"))
            Run(connection, script);
    }

    private static IEnumerable<string> ScriptsIn(string folder)
    {
        var path = Path.Combine(ScriptsRoot, folder);

        // A module may have no migrations yet, and a folder with no .sql in it is not
        // copied to the output at all -- "nothing to run" is not an error.
        return Directory.Exists(path)
            ? Directory.GetFiles(path, "*.sql").OrderBy(file => file, StringComparer.Ordinal)
            : [];
    }

    /// <summary>Runs a script, which is written for SqlPackage and so is split into batches by GO.</summary>
    private static void Run(SqlConnection connection, string path)
    {
        foreach (var batch in Batches(File.ReadAllText(path)))
        {
            using var command = connection.CreateCommand();
            command.CommandText = batch;
            command.CommandTimeout = 300;
            command.ExecuteNonQuery();
        }
    }

    private static string[] Batches(string script) =>
        Regex.Split(script, @"^\s*GO\s*(?:\d+)?\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)
             .Where(batch => !string.IsNullOrWhiteSpace(batch))
             .ToArray();

    /// <summary>
    /// The error SQL Server answers a refusal to create a database with. The number is
    /// the reliable part; the phrase is checked as well, because a server that words it
    /// differently is still refusing for the same reason.
    /// </summary>
    private const int CreateDatabaseRefused = 262;

    private static void CreateDatabase(string connectionString, string database)
    {
        var master = new SqlConnectionStringBuilder(connectionString) { InitialCatalog = "master" }.ConnectionString;

        try
        {
            Execute(master, $"IF DB_ID(N'{database}') IS NULL CREATE DATABASE [{database}];");
        }
        catch (SqlException ex) when (Refused(ex))
        {
            // Said once and with something to do about it, rather than a stack trace
            // repeated for every test class in the suite.
            throw new InvalidOperationException(CannotCreate(connectionString), ex);
        }
    }

    private static void Execute(string connectionString, string sql)
    {
        using var connection = Open(connectionString);

        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.CommandTimeout = 300;
        command.ExecuteNonQuery();
    }

    /// <summary>
    /// Whether SQL Server refused for want of permission, rather than for any other
    /// reason there might be for a CREATE DATABASE to fail.
    /// </summary>
    private static bool Refused(SqlException ex) =>
        ex.Number == CreateDatabaseRefused ||
        ex.Message.Contains("CREATE DATABASE permission denied", StringComparison.OrdinalIgnoreCase);

    /// <summary>The one environmental failure this suite has, and what can be done about it.</summary>
    private static string CannotCreate(string connectionString) =>
        "The account the tests run as cannot create a database on "
        + $"'{new SqlConnectionStringBuilder(connectionString).DataSource}'. Every test class builds its own "
        + "throwaway database there and drops it again, so that account needs CREATE DATABASE on that server -- "
        + "the dbcreator server role -- or the tests need pointing at a server where it already has it, through "
        + "the Folio_TEST_SQL_SERVER environment variable. A development login normally has it, and a deployment "
        + "one is what tends not to, which is why this turns up in a deploy rather than on a laptop.";

    private static SqlConnection Open(string connectionString)
    {
        var connection = new SqlConnection(connectionString);
        try
        {
            connection.Open();
            return connection;
        }
        catch (SqlException ex) when (ex.Number is 18456 or 4060)
        {
            // The server answered, so it is up: it is the credentials or the database it was
            // asked for that were refused. Saying "could not reach" here sends whoever is
            // reading the log looking for a broken server that is working fine.
            connection.Dispose();
            throw new InvalidOperationException(
                $"SQL Server at '{new SqlConnectionStringBuilder(connectionString).DataSource}' refused the test "
                + $"connection: {ex.Message.Trim()} The tests build their own databases, so the account they run "
                + "as has to be able to connect and to create one. On the box, scripts\\bootstrap.ps1 grants the "
                + "runner exactly that; anywhere else, grant dbcreator by hand. Nothing was tested.",
                ex);
        }
        catch (SqlException ex)
        {
            connection.Dispose();
            throw new InvalidOperationException(
                $"Could not reach SQL Server at '{new SqlConnectionStringBuilder(connectionString).DataSource}'. "
                + "The tests each build their own database, so they need a SQL Server to build it on: start one, "
                + "or point the Folio_TEST_SQL_SERVER environment variable at it.",
                ex);
        }
    }

    private static SqlConnectionStringBuilder Builder(string server) =>
        server.Contains('=')
            ? new SqlConnectionStringBuilder(server)
            : new SqlConnectionStringBuilder
            {
                DataSource = server,
                IntegratedSecurity = true,
                TrustServerCertificate = true,

                // Long enough for a slow LocalDB start, short enough that a machine with
                // no server at all reports skipped tests instead of hanging on discovery.
                ConnectTimeout = 10,
            };

    private static bool Probe()
    {
        try
        {
            using var connection = new SqlConnection(ConnectionString(Server, "master"));
            connection.Open();
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static string DescribeFailure()
    {
        var server = new SqlConnectionStringBuilder(ConnectionString(Server, "master")).DataSource;

        return $"No SQL Server at '{server}'. Every test class builds its own throwaway database there and "
            + "drops it again, so the account the tests run as needs CREATE DATABASE -- the dbcreator server "
            + "role. On a laptop, 'sqllocaldb create Folio' makes the instance these tests expect; point "
            + "Folio_TEST_SQL_SERVER somewhere else to use a different server. Set Folio_REQUIRE_DATABASE_TESTS=1 "
            + "to make this a failure rather than a skip, which is what the deploy does.";
    }
}
