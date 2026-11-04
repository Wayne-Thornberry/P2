using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

public sealed partial class WorkspaceService
{
    // ── Transactions ────────────────────────────────────────────────────────────────────

    private async Task<TransactionsBlob?> ReadTransactionsAsync(string country, CancellationToken cancellationToken)
    {
        var rows = await db.Transactions.AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return null;

        var transactions = rows
            .Select(row => new TransactionDto(
                row.Id,
                row.Name,
                row.Date,
                Utc(row.CreatedAt),
                row.Amount,
                row.Type,
                row.ItemId,
                row.AccountId,
                row.Notes,
                row.Flagged,
                row.Locked,
                row.Recurring))
            .ToList();

        return new TransactionsBlob(
            transactions,
            await ReadCounterAsync(country, CounterNames.Transactions, cancellationToken));
    }

    public async Task SaveTransactionsAsync(string country, TransactionsBlob blob, CancellationToken cancellationToken)
    {
        var rows = (blob.Transactions ?? [])
            .Select((transaction, index) => new TransactionRow
            {
                UserId = me.Id,
                Country = country,
                Id = transaction.Id,
                Name = Text(transaction.Name, "Transaction", 200),
                Date = transaction.Date,
                CreatedAt = UtcInput(transaction.CreatedAt),
                Amount = transaction.Amount,
                Type = transaction.Type == "in" ? "in" : "out",
                ItemId = transaction.ItemId,
                AccountId = Optional(transaction.AccountId, 32),
                Notes = Optional(transaction.Notes, 1000),
                Flagged = transaction.Flagged,
                Locked = transaction.Locked,
                Recurring = transaction.Recurring,
                SortOrder = index,
            })
            .ToList();

        await ReplaceAsync(
            db.Transactions.Where(row => row.UserId == me.Id && row.Country == country),
            rows,
            cancellationToken);

        await SetCounterAsync(country, CounterNames.Transactions, blob.NextId, cancellationToken);
    }
}
