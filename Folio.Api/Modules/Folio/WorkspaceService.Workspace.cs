using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

public sealed partial class WorkspaceService
{
    // ── The whole workspace ─────────────────────────────────────────────────────────────

    public async Task<WorkspaceResponse> ReadAsync(string country, CancellationToken cancellationToken) =>
        new()
        {
            Accounts = await ReadAccountsAsync(country, cancellationToken),
            Transactions = await ReadTransactionsAsync(country, cancellationToken),
            Upcoming = await ReadUpcomingAsync(country, cancellationToken),
            Budget = await ReadBudgetAsync(country, cancellationToken),
            Template = await ReadTemplateAsync(country, cancellationToken),
            SavingsGoals = await ReadSavingsGoalsAsync(country, cancellationToken),
            Finance = await ReadFinanceAsync(country, cancellationToken),
            Planner = await ReadPlannerAsync(country, cancellationToken),
            ImportHistory = await ReadImportHistoryAsync(country, cancellationToken),
        };

    /// <summary>
    /// Every country this account has anything saved for, which is what an export of all
    /// countries is built from.
    ///
    /// The union is over the three tables a budget cannot exist without rather than
    /// every table: a country with no accounts and no transactions is a country with
    /// nothing to export.
    /// </summary>
    public async Task<IReadOnlyList<string>> ListCountriesAsync(CancellationToken cancellationToken)
    {
        var fromCounters = db.Counters.Where(row => row.UserId == me.Id).Select(row => row.Country);
        var fromAccounts = db.Accounts.Where(row => row.UserId == me.Id).Select(row => row.Country);
        var fromTransactions = db.Transactions.Where(row => row.UserId == me.Id).Select(row => row.Country);

        return await fromCounters
            .Union(fromAccounts)
            .Union(fromTransactions)
            .OrderBy(country => country)
            .ToListAsync(cancellationToken);
    }
}
