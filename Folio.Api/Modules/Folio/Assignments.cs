using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

/// <summary>
/// The money assigned to a budget month, which is what "overspent" is measured against.
///
/// The site copies last month's budget into a month it has not seen yet, so a month with no
/// rows of its own runs on its predecessor's. That rule lives here once, because the health
/// score and the dashboard both ask the same question and must not answer it differently.
/// </summary>
internal static class Assignments
{
    /// <summary>How far back to look for the assignments a month has none of its own.</summary>
    private const int LookBackMonths = 24;

    public static async Task<List<BudgetLine>> ReadAsync(
        FolioDbContext db,
        int userId,
        string country,
        DateOnly month,
        CancellationToken cancellationToken)
    {
        for (var back = 0; back < LookBackMonths; back++)
        {
            var at = month.AddMonths(-back);

            var lines = await db.BudgetAssignments
                .AsNoTracking()
                .Where(row => row.UserId == userId && row.Country == country && row.Year == at.Year && row.Month == at.Month)
                .Select(row => new BudgetLine(row.ItemId, row.Assigned))
                .ToListAsync(cancellationToken);

            if (lines.Count > 0)
                return lines;
        }

        return [];
    }

    /// <summary>The name a budget item goes by, by id, for the lines above.</summary>
    public static async Task<Dictionary<int, string>> NamesAsync(
        FolioDbContext db,
        int userId,
        string country,
        CancellationToken cancellationToken) =>
        await db.BudgetItems
            .AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .ToDictionaryAsync(row => row.Id, row => row.Name, cancellationToken);
}

/// <summary>A budget line's assignment, which is what "overspent" is measured against.</summary>
public sealed record BudgetLine(int ItemId, decimal Assigned);
