using Microsoft.EntityFrameworkCore;
using Folio.Api.Http;

namespace Folio.Api.Modules.Folio;

/// <summary>
/// The Folio module: the whole budget.
///
/// It has one schema, one set of tables and one page, because Folio is one app rather
/// than a collection of little ones — the budget, the accounts and the reports share the
/// same transactions, so splitting them into separate modules would only mean copying the
/// same rows between them.
///
/// Reads are one request for the whole workspace; writes are one aggregate at a time,
/// replaced in a transaction. That matches what the site holds in memory, so a change made
/// in the browser is saved exactly as the app already thought of it.
///
/// Nothing here asks who is calling: this is a budget on a private box, and the country is
/// what separates one budget from another.
/// </summary>
public sealed class FolioModule : IFolioModule
{
    public const string ModuleName = "folio";

    /// <summary>The schema this module's tables live in. A script in Folio.Database creates it.</summary>
    public const string SchemaName = "folio";

    /// <summary>The longest country id the columns accept.</summary>
    public const int CountryMaxLength = 40;

    public string Name => ModuleName;

    public void AddServices(IServiceCollection services, IConfiguration configuration) =>
        services.AddScoped<WorkspaceService>();

    public void Map(RouteGroupBuilder api)
    {
        api.MapGet("/workspace", GetWorkspaceAsync);
        api.MapDelete("/workspace", DeleteWorkspaceAsync);
        api.MapGet("/countries", ListCountriesAsync);

        api.MapGet("/settings", GetSettingsAsync);
        api.MapPut("/settings", SaveSettingsAsync);

        api.MapPut("/accounts", SaveAccountsAsync);
        api.MapPut("/transactions", SaveTransactionsAsync);
        api.MapPut("/upcoming", SaveUpcomingAsync);
        api.MapPut("/budget", SaveBudgetAsync);
        api.MapPut("/template", SaveTemplateAsync);
        api.MapPut("/savings-goals", SaveSavingsGoalsAsync);
        api.MapPut("/finance", SaveFinanceAsync);
        api.MapPut("/planner", SavePlannerAsync);
        api.MapPut("/import-history", SaveImportHistoryAsync);
    }

    private static async Task<IResult> GetWorkspaceAsync(
        string? country,
        WorkspaceService workspace,
        CancellationToken cancellationToken)
    {
        if (Country(country) is not { } name)
            return ApiErrors.BadRequest("A country is needed: ?country=ireland.");

        return Results.Ok(await workspace.ReadAsync(name, cancellationToken));
    }

    /// <summary>
    /// Removes everything saved for one country, so a budget can start again without the
    /// other country being touched.
    /// </summary>
    private static async Task<IResult> DeleteWorkspaceAsync(
        string? country,
        Data.FolioDbContext db,
        CancellationToken cancellationToken)
    {
        if (Country(country) is not { } name)
            return ApiErrors.BadRequest("A country is needed: ?country=ireland.");

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // Children before parents, because the foreign keys say so.
        await db.PlannerSimulationItems.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.PlannerSimulations.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.SavingsContributions.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.BudgetAssignments.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.Transactions.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.UpcomingTransactions.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.Accounts.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.BudgetItems.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.BudgetTemplateEntries.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.SavingsGoals.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.Loans.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.SavingsRecords.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.PlannerItems.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.PlannerState.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.ImportHistory.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);
        await db.Counters.Where(row => row.Country == name).ExecuteDeleteAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        return Results.NoContent();
    }

    private static async Task<IResult> ListCountriesAsync(
        WorkspaceService workspace,
        CancellationToken cancellationToken) =>
        Results.Ok(await workspace.ListCountriesAsync(cancellationToken));

    private static async Task<IResult> GetSettingsAsync(
        WorkspaceService workspace,
        CancellationToken cancellationToken)
    {
        var settings = await workspace.ReadSettingsAsync(cancellationToken);

        return settings is null ? Results.NoContent() : Results.Ok(settings);
    }

    private static async Task<IResult> SaveSettingsAsync(
        SettingsBlob blob,
        WorkspaceService workspace,
        CancellationToken cancellationToken)
    {
        await workspace.SaveSettingsAsync(blob, cancellationToken);

        return Results.NoContent();
    }

    private static async Task<IResult> SaveAccountsAsync(
        string? country,
        AccountsBlob blob,
        WorkspaceService workspace,
        CancellationToken cancellationToken) =>
        await SaveAsync(country, (name) => workspace.SaveAccountsAsync(name, blob, cancellationToken));

    private static async Task<IResult> SaveTransactionsAsync(
        string? country,
        TransactionsBlob blob,
        WorkspaceService workspace,
        CancellationToken cancellationToken) =>
        await SaveAsync(country, (name) => workspace.SaveTransactionsAsync(name, blob, cancellationToken));

    private static async Task<IResult> SaveUpcomingAsync(
        string? country,
        UpcomingBlob blob,
        WorkspaceService workspace,
        CancellationToken cancellationToken) =>
        await SaveAsync(country, (name) => workspace.SaveUpcomingAsync(name, blob, cancellationToken));

    private static async Task<IResult> SaveBudgetAsync(
        string? country,
        BudgetBlob blob,
        WorkspaceService workspace,
        CancellationToken cancellationToken) =>
        await SaveAsync(country, (name) => workspace.SaveBudgetAsync(name, blob, cancellationToken));

    private static async Task<IResult> SaveTemplateAsync(
        string? country,
        TemplateBlob blob,
        WorkspaceService workspace,
        CancellationToken cancellationToken) =>
        await SaveAsync(country, (name) => workspace.SaveTemplateAsync(name, blob, cancellationToken));

    private static async Task<IResult> SaveSavingsGoalsAsync(
        string? country,
        SavingsGoalsBlob blob,
        WorkspaceService workspace,
        CancellationToken cancellationToken) =>
        await SaveAsync(country, (name) => workspace.SaveSavingsGoalsAsync(name, blob, cancellationToken));

    private static async Task<IResult> SaveFinanceAsync(
        string? country,
        FinanceBlob blob,
        WorkspaceService workspace,
        CancellationToken cancellationToken) =>
        await SaveAsync(country, (name) => workspace.SaveFinanceAsync(name, blob, cancellationToken));

    private static async Task<IResult> SavePlannerAsync(
        string? country,
        PlannerBlob blob,
        WorkspaceService workspace,
        CancellationToken cancellationToken) =>
        await SaveAsync(country, (name) => workspace.SavePlannerAsync(name, blob, cancellationToken));

    private static async Task<IResult> SaveImportHistoryAsync(
        string? country,
        ImportHistoryBlob blob,
        WorkspaceService workspace,
        CancellationToken cancellationToken) =>
        await SaveAsync(country, (name) => workspace.SaveImportHistoryAsync(name, blob, cancellationToken));

    /// <summary>
    /// The shape every collection save has: a country, or a refusal. One place rather than
    /// ten copies of the same three lines.
    /// </summary>
    private static async Task<IResult> SaveAsync(string? country, Func<string, Task> save)
    {
        if (Country(country) is not { } name)
            return ApiErrors.BadRequest("A country is needed: ?country=ireland.");

        await save(name);

        return Results.NoContent();
    }

    /// <summary>Why this country cannot be used, or the value to use.</summary>
    private static string? Country(string? value)
    {
        var country = value?.Trim();

        if (string.IsNullOrEmpty(country) || country.Length > CountryMaxLength)
            return null;

        return country;
    }
}
