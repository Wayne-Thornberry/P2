using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

public sealed partial class WorkspaceService
{
    // ── Settings ────────────────────────────────────────────────────────────────────────

    public async Task<SettingsBlob?> ReadSettingsAsync(CancellationToken cancellationToken)
    {
        var row = await db.Settings.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == me.Id, cancellationToken);

        return row is null
            ? null
            : new SettingsBlob(
                row.Theme,
                row.Locale,
                row.Currency,
                row.DateStyle,
                row.TimeStyle,
                row.Country,
                row.BillableMonthStart,
                row.BalanceCutoffTxId);
    }

    public async Task SaveSettingsAsync(SettingsBlob blob, CancellationToken cancellationToken)
    {
        var row = await db.Settings.FirstOrDefaultAsync(row => row.UserId == me.Id, cancellationToken);

        if (row is null)
        {
            row = new Settings { UserId = me.Id };
            db.Settings.Add(row);
        }

        row.Theme = Text(blob.Theme, "light", 16);
        row.Locale = Text(blob.Locale, "en-IE", 32);
        row.Currency = Text(blob.Currency, "EUR", 3);
        row.DateStyle = Text(blob.DateStyle, "medium", 8);
        row.TimeStyle = Text(blob.TimeStyle, "24h", 4);
        row.Country = Optional(blob.Country, 40);
        row.BillableMonthStart = (byte)Math.Clamp(blob.BillableMonthStart ?? 1, 1, 28);
        row.BalanceCutoffTxId = blob.BalanceCutoffTxId;

        await db.SaveChangesAsync(cancellationToken);
    }
}
