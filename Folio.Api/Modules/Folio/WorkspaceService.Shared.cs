using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

public sealed partial class WorkspaceService
{
    // ── Shared helpers ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Deletes what is there and inserts what should be, without a tracker in the way.
    ///
    /// The delete is a statement rather than <c>RemoveRange</c> because a table keyed on
    /// (user, country, id) is re-inserting rows with the same key, and one SaveChanges
    /// would leave the order of the delete and the insert to EF.
    /// </summary>
    private async Task ReplaceAsync<T>(IQueryable<T> existing, List<T> rows, CancellationToken cancellationToken)
        where T : class
    {
        await existing.ExecuteDeleteAsync(cancellationToken);

        if (rows.Count > 0)
        {
            db.AddRange(rows);
            await db.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task<int?> ReadCounterAsync(string country, string name, CancellationToken cancellationToken)
    {
        var row = await db.Counters.AsNoTracking()
            .FirstOrDefaultAsync(counter => counter.Country == country && counter.Name == name, cancellationToken);

        return row?.Value;
    }

    private async Task SetCounterAsync(string country, string name, int? value, CancellationToken cancellationToken)
    {
        if (value is not { } next)
            return;

        var row = await db.Counters.FirstOrDefaultAsync(
            counter => counter.Country == country && counter.Name == name, cancellationToken);

        if (row is null)
            db.Counters.Add(new Counter { Country = country, Name = name, Value = next });
        else
            row.Value = next;

        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>A required value, trimmed and cut to the column's width, with a fallback.</summary>
    internal static string Text(string? value, string fallback, int maxLength)
    {
        var text = (value ?? "").Trim();

        if (text.Length == 0)
            text = fallback;

        return text.Length <= maxLength ? text : text[..maxLength];
    }

    /// <summary>A value that is absent rather than empty: the site treats the two differently.</summary>
    internal static string? Optional(string? value, int maxLength)
    {
        var text = value?.Trim();

        if (string.IsNullOrEmpty(text))
            return null;

        return text.Length <= maxLength ? text : text[..maxLength];
    }

    /// <summary>
    /// A timestamp read back out of SQL Server, which has forgotten it was UTC.
    ///
    /// The site writes ISO strings with a Z on the end, so answering without one would
    /// make a saved date read as local time.
    /// </summary>
    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    /// <summary>A timestamp on its way in, made UTC before it loses the information.</summary>
    private static DateTime UtcInput(DateTime value) =>
        value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
        };
}
