using Microsoft.Data.SqlClient;

namespace Folio.Api.Tests;

/// <summary>
/// The database project's rules, as tests.
///
/// The schema is a model plus a numbered history, and the two have to stay in step: a
/// database built from the model must end up exactly where the migrations leave one.
/// These are the checks that catch the two drifting apart, without putting a .dacpac
/// through SqlPackage.
/// </summary>
public sealed class DatabaseMigrationTests : IDisposable
{
    private readonly string _database = $"Folio_Migration_{Guid.NewGuid():N}";

    private string ConnectionString => TestDatabase.ConnectionString(TestDatabase.Server, _database);

    /// <summary>Where the copied scripts sit, which is the same place TestDatabase reads.</summary>
    private static string ScriptsRoot => Path.Combine(AppContext.BaseDirectory, "Schema");

    [Fact]
    public void Every_migration_is_numbered_so_the_order_is_the_filename()
    {
        var folder = Path.Combine(ScriptsRoot, "Migrations");
        var migrations = Directory.Exists(folder) ? Directory.GetFiles(folder, "*.sql") : [];

        Assert.All(migrations, path =>
        {
            // Four digits and a fixed width: a sort by name is a sort by number, which is
            // what makes "the order is the filename" true past nine scripts.
            Assert.Matches(@"^\d{4}_[A-Za-z0-9]+\.sql$", Path.GetFileName(path));
        });

        Assert.Equal(
            migrations.Length,
            migrations.Select(Path.GetFileName).Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [DatabaseFact]
    public void The_model_scripts_create_the_tables_the_api_maps()
    {
        TestDatabase.Create(TestDatabase.Server, _database);

        Assert.All(
            new[]
            {
                "core.Users",
                "core.Sessions",
                "folio.Settings",
                "folio.Counters",
                "folio.Accounts",
                "folio.Transactions",
                "folio.UpcomingTransactions",
                "folio.BudgetItems",
                "folio.BudgetAssignments",
                "folio.BudgetTemplateEntries",
                "folio.SavingsGoals",
                "folio.SavingsContributions",
                "folio.Loans",
                "folio.SavingsRecords",
                "folio.PlannerState",
                "folio.PlannerItems",
                "folio.PlannerSimulations",
                "folio.PlannerSimulationItems",
                "folio.ImportHistory",
            },
            table => Assert.True(TableExists(table), $"{table} was not created by the model scripts."));
    }

    [DatabaseFact]
    public void Applying_the_migrations_to_a_fresh_database_succeeds()
    {
        // A fresh database already has the final shape, so the migrations are no-ops
        // there. That they run without error is the point: the same scripts are what a
        // deploy runs against a database that is years old, and they have to be safe on
        // both.
        TestDatabase.Create(TestDatabase.Server, _database);

        TestDatabase.ApplyMigrations(ConnectionString);
    }

    [DatabaseFact]
    public void The_amount_column_is_the_precision_the_api_and_the_site_think_it_is()
    {
        TestDatabase.Create(TestDatabase.Server, _database);

        // Money is decimal(18,4) rather than float: the site rounds for display, and a
        // saved amount has to come back as the amount that was saved. A column the app
        // disagrees with would show up as a fund total that drifts by a cent.
        Assert.Equal("decimal", ColumnInfo("folio.Transactions", "Amount", "TYPE_NAME(c.system_type_id)"));
        Assert.Equal("18", ColumnInfo("folio.Transactions", "Amount", "c.precision"));
        Assert.Equal("4", ColumnInfo("folio.Transactions", "Amount", "c.scale"));
    }

    public void Dispose() => TestDatabase.Drop(TestDatabase.Server, _database);

    private bool TableExists(string qualifiedName)
    {
        using var connection = new SqlConnection(ConnectionString);
        connection.Open();

        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT COUNT(*)
            FROM sys.tables AS t
            JOIN sys.schemas AS s ON s.schema_id = t.schema_id
            WHERE s.name = @schema AND t.name = @table
            """;

        var (schema, table) = Split(qualifiedName);
        command.Parameters.AddWithValue("@schema", schema);
        command.Parameters.AddWithValue("@table", table);

        return Convert.ToInt32(command.ExecuteScalar()) == 1;
    }

    /// <summary>One column's detail, chosen from the two fixed expressions below.</summary>
    private string ColumnInfo(string qualifiedName, string column, string select)
    {
        using var connection = new SqlConnection(ConnectionString);
        connection.Open();

        using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT {select}
            FROM sys.columns AS c
            JOIN sys.tables AS t ON t.object_id = c.object_id
            JOIN sys.schemas AS s ON s.schema_id = t.schema_id
            WHERE s.name = @schema AND t.name = @table AND c.name = @column
            """;

        var (schema, table) = Split(qualifiedName);
        command.Parameters.AddWithValue("@schema", schema);
        command.Parameters.AddWithValue("@table", table);
        command.Parameters.AddWithValue("@column", column);

        return Convert.ToString(command.ExecuteScalar()) ?? "";
    }

    private static (string Schema, string Table) Split(string qualifiedName) =>
        qualifiedName.Split('.') is [var schema, var table]
            ? (schema, table)
            : throw new ArgumentException($"'{qualifiedName}' is not schema.table.", nameof(qualifiedName));
}
