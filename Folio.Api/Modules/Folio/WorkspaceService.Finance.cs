using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

public sealed partial class WorkspaceService
{
    // ── Loans and savings records ──────────────────────────────────────────────────────

    private async Task<FinanceBlob?> ReadFinanceAsync(string country, CancellationToken cancellationToken)
    {
        var loans = await db.Loans.AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var savings = await db.SavingsRecords.AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (loans.Count == 0 && savings.Count == 0)
            return null;

        return new FinanceBlob(
            loans.Select(row => new LoanDto(
                row.Id,
                row.Name,
                row.Principal,
                row.Apr,
                row.TermMonths,
                row.StartDate,
                row.LinkedAccountId,
                row.Color,
                Utc(row.CreatedAt),
                row.Archived)).ToList(),
            savings.Select(row => new SavingsRecordDto(
                row.Id,
                row.Name,
                row.Apr,
                row.CompoundFreq,
                row.StartBalance,
                row.StartDate,
                row.LinkedAccountId,
                row.Color,
                Utc(row.CreatedAt),
                row.Archived)).ToList(),
            await ReadCounterAsync(country, CounterNames.Loans, cancellationToken),
            await ReadCounterAsync(country, CounterNames.SavingsRecords, cancellationToken));
    }

    public async Task SaveFinanceAsync(string country, FinanceBlob blob, CancellationToken cancellationToken)
    {
        var loans = (blob.Loans ?? [])
            .Select((loan, index) => new Loan
            {
                UserId = me.Id,
                Country = country,
                Id = loan.Id,
                Name = Text(loan.Name, "Loan", 100),
                Principal = loan.Principal,
                Apr = loan.Apr,
                TermMonths = loan.TermMonths,
                StartDate = loan.StartDate,
                LinkedAccountId = Optional(loan.LinkedAccountId, 32),
                Color = Text(loan.Color, "#6366f1", 32),
                CreatedAt = UtcInput(loan.CreatedAt),
                Archived = loan.Archived,
                SortOrder = index,
            })
            .ToList();

        var savings = (blob.Savings ?? [])
            .Select((record, index) => new SavingsRecord
            {
                UserId = me.Id,
                Country = country,
                Id = record.Id,
                Name = Text(record.Name, "Savings", 100),
                Apr = record.Apr,
                CompoundFreq = record.CompoundFreq is "monthly" or "quarterly" or "annually" ? record.CompoundFreq : "monthly",
                StartBalance = record.StartBalance,
                StartDate = record.StartDate,
                LinkedAccountId = Optional(record.LinkedAccountId, 32),
                Color = Text(record.Color, "#6366f1", 32),
                CreatedAt = UtcInput(record.CreatedAt),
                Archived = record.Archived,
                SortOrder = index,
            })
            .ToList();

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        await ReplaceAsync(db.Loans.Where(row => row.UserId == me.Id && row.Country == country), loans, cancellationToken);
        await ReplaceAsync(db.SavingsRecords.Where(row => row.UserId == me.Id && row.Country == country), savings, cancellationToken);

        await SetCounterAsync(country, CounterNames.Loans, blob.NextLoanId, cancellationToken);
        await SetCounterAsync(country, CounterNames.SavingsRecords, blob.NextSavId, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }
}
