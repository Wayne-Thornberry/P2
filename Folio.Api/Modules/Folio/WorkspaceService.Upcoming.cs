using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

public sealed partial class WorkspaceService
{
    // ── Upcoming transactions ───────────────────────────────────────────────────────────

    private async Task<UpcomingBlob?> ReadUpcomingAsync(string country, CancellationToken cancellationToken)
    {
        var rows = await db.UpcomingTransactions.AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return null;

        var items = rows
            .Select(row => new UpcomingDto(
                row.Id,
                row.Title,
                row.Amount,
                row.Type,
                row.Date,
                row.Notes,
                row.Done,
                row.LinkedTransactionId,
                Utc(row.CreatedAt),
                row.Recurring))
            .ToList();

        return new UpcomingBlob(items, await ReadCounterAsync(country, CounterNames.Upcoming, cancellationToken));
    }

    public async Task SaveUpcomingAsync(string country, UpcomingBlob blob, CancellationToken cancellationToken)
    {
        var rows = (blob.Items ?? [])
            .Select((item, index) => new UpcomingTransactionRow
            {
                UserId = me.Id,
                Country = country,
                Id = item.Id,
                Title = Text(item.Title, "Planned", 200),
                Amount = item.Amount,
                Type = item.Type == "in" ? "in" : "out",
                Date = item.Date,
                Notes = Optional(item.Notes, 1000),
                Done = item.Done,
                LinkedTransactionId = item.LinkedTransactionId,
                CreatedAt = UtcInput(item.CreatedAt),
                Recurring = item.Recurring is "weekly" or "monthly" or "yearly" ? item.Recurring : null,
                SortOrder = index,
            })
            .ToList();

        await ReplaceAsync(
            db.UpcomingTransactions.Where(row => row.UserId == me.Id && row.Country == country),
            rows,
            cancellationToken);

        await SetCounterAsync(country, CounterNames.Upcoming, blob.NextId, cancellationToken);
    }
}
