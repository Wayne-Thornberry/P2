using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

public sealed partial class WorkspaceService
{
    // ── Accounts ────────────────────────────────────────────────────────────────────────

    private async Task<AccountsBlob?> ReadAccountsAsync(string country, CancellationToken cancellationToken)
    {
        var rows = await db.Accounts.AsNoTracking()
            .Where(row => row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return null;

        var accounts = rows
            .Select(row => new AccountDto(row.Id, row.Name, row.Type, row.ExcludeFromBudget, row.Archived, row.BankId))
            .ToList();

        return new AccountsBlob(accounts, await ReadCounterAsync(country, CounterNames.Accounts, cancellationToken));
    }

    public async Task SaveAccountsAsync(string country, AccountsBlob blob, CancellationToken cancellationToken)
    {
        var rows = (blob.Accounts ?? [])
            .Where(account => !string.IsNullOrWhiteSpace(account.Id))
            .Select((account, index) => new Account
            {
                Country = country,
                Id = account.Id.Trim(),
                Name = Text(account.Name, account.Id, 100),
                Type = Optional(account.Type, 16),
                ExcludeFromBudget = account.ExcludeFromBudget,
                Archived = account.Archived,
                BankId = Optional(account.BankId, 32),
                SortOrder = index,
            })
            .ToList();

        await ReplaceAsync(
            db.Accounts.Where(row => row.Country == country),
            rows,
            cancellationToken);

        await SetCounterAsync(country, CounterNames.Accounts, blob.NextId, cancellationToken);
    }
}
