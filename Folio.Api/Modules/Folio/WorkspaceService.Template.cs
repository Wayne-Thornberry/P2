using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

public sealed partial class WorkspaceService
{
    // ── Budget template ────────────────────────────────────────────────────────────────

    private async Task<TemplateBlob?> ReadTemplateAsync(string country, CancellationToken cancellationToken)
    {
        var rows = await db.BudgetTemplateEntries.AsNoTracking()
            .Where(row => row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        return rows.Count == 0
            ? null
            : new TemplateBlob(rows.Select(row => new BudgetEntryDto(row.ItemId, row.Assigned, row.Category)).ToList());
    }

    public async Task SaveTemplateAsync(string country, TemplateBlob blob, CancellationToken cancellationToken)
    {
        var rows = (blob.Entries ?? [])
            .Select((entry, index) => new BudgetTemplateEntry
            {
                Country = country,
                ItemId = entry.ItemId,
                Assigned = entry.Assigned,
                Category = Text(entry.Category, "", 100),
                SortOrder = index,
            })
            .ToList();

        await ReplaceAsync(
            db.BudgetTemplateEntries.Where(row => row.Country == country),
            rows,
            cancellationToken);
    }
}
