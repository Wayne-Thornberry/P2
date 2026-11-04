using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

public sealed partial class WorkspaceService
{
    // ── Budget ──────────────────────────────────────────────────────────────────────────

    private async Task<BudgetBlob?> ReadBudgetAsync(string country, CancellationToken cancellationToken)
    {
        var items = await db.BudgetItems.AsNoTracking()
            .Where(row => row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var assignments = await db.BudgetAssignments.AsNoTracking()
            .Where(row => row.Country == country)
            .OrderBy(row => row.Year).ThenBy(row => row.Month).ThenBy(row => row.ItemId)
            .ToListAsync(cancellationToken);

        if (items.Count == 0 && assignments.Count == 0)
            return null;

        var months = new Dictionary<string, Dictionary<string, List<BudgetEntryDto>>>();

        foreach (var row in assignments)
        {
            var year = row.Year.ToString(System.Globalization.CultureInfo.InvariantCulture);
            var month = row.Month.ToString(System.Globalization.CultureInfo.InvariantCulture);

            if (!months.TryGetValue(year, out var byMonth))
                months[year] = byMonth = [];

            if (!byMonth.TryGetValue(month, out var entries))
                byMonth[month] = entries = [];

            entries.Add(new BudgetEntryDto(row.ItemId, row.Assigned, row.Category));
        }

        return new BudgetBlob(
            items.Select(row => new BudgetItemDto(row.Id, row.Name)).ToList(),
            months,
            await ReadCounterAsync(country, CounterNames.Budget, cancellationToken));
    }

    public async Task SaveBudgetAsync(string country, BudgetBlob blob, CancellationToken cancellationToken)
    {
        var items = (blob.GlobalItems ?? [])
            .Select((item, index) => new BudgetItem
            {
                Country = country,
                Id = item.Id,
                Name = Text(item.Name, "Item", 100),
                SortOrder = index,
            })
            .ToList();

        var assignments = new List<BudgetAssignment>();

        foreach (var (yearText, byMonth) in blob.MonthlyEntries ?? [])
        {
            if (!short.TryParse(yearText, out var year))
                continue;

            foreach (var (monthText, entries) in byMonth ?? [])
            {
                if (!byte.TryParse(monthText, out var month) || month is < 1 or > 12)
                    continue;

                foreach (var entry in entries ?? [])
                {
                    assignments.Add(new BudgetAssignment
                    {
                        Country = country,
                        Year = year,
                        Month = month,
                        ItemId = entry.ItemId,
                        Assigned = entry.Assigned,
                        Category = Text(entry.Category, "", 100),
                    });
                }
            }
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        await db.BudgetAssignments.Where(row => row.Country == country).ExecuteDeleteAsync(cancellationToken);
        await ReplaceAsync(db.BudgetItems.Where(row => row.Country == country), items, cancellationToken);

        db.BudgetAssignments.AddRange(assignments);
        await db.SaveChangesAsync(cancellationToken);

        await SetCounterAsync(country, CounterNames.Budget, blob.NextId, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }
}
