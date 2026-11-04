using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

public sealed partial class WorkspaceService
{
    // ── Import history ─────────────────────────────────────────────────────────────────

    private async Task<ImportHistoryBlob?> ReadImportHistoryAsync(string country, CancellationToken cancellationToken)
    {
        var rows = await db.ImportHistory.AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return null;

        var imports = rows
            .Select(row => new ImportRecordDto(row.Id, Utc(row.Date), row.BankName, row.AdapterId, row.FileName, row.RowCount))
            .ToList();

        return new ImportHistoryBlob(
            imports,
            await ReadCounterAsync(country, CounterNames.ImportHistory, cancellationToken));
    }

    public async Task SaveImportHistoryAsync(string country, ImportHistoryBlob blob, CancellationToken cancellationToken)
    {
        var rows = (blob.Imports ?? [])
            .Select((import, index) => new ImportRecord
            {
                UserId = me.Id,
                Country = country,
                Id = import.Id,
                Date = UtcInput(import.Date),
                BankName = Text(import.BankName, "", 100),
                AdapterId = Text(import.AdapterId, "", 32),
                FileName = Text(import.FileName, "", 260),
                RowCount = import.RowCount,
                SortOrder = index,
            })
            .ToList();

        await ReplaceAsync(
            db.ImportHistory.Where(row => row.UserId == me.Id && row.Country == country),
            rows,
            cancellationToken);

        await SetCounterAsync(country, CounterNames.ImportHistory, blob.NextId, cancellationToken);
    }
}
