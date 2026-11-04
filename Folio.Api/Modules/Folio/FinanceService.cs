using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

/// <summary>
/// What the loans and savings accounts come to, worked out here rather than in the browser.
///
/// An amortisation schedule and a compounding balance are the kind of arithmetic that is
/// easy to write twice and almost impossible to keep identical twice: the monthly payment
/// for one loan already decides the dashboard's remaining balance, the payoff month and the
/// interest paid. It is computed once, in <see cref="Compute"/>, which takes rows and a day
/// and nothing else.
///
/// The arithmetic is in <c>double</c> on purpose. It was in the browser, and a projection
/// that lands a penny away from the one the Finance page draws would be worse than no
/// projection at all; the money is rounded to cents at every step the browser rounded it.
/// </summary>
public sealed class FinanceService(FolioDbContext db, TimeProvider clock)
{
    public async Task<FinanceSummary> ReadAsync(string country, CancellationToken cancellationToken)
    {
        var loans = await db.Loans
            .AsNoTracking()
            .Where(row => row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ThenBy(row => row.Id)
            .ToListAsync(cancellationToken);

        var savings = await db.SavingsRecords
            .AsNoTracking()
            .Where(row => row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ThenBy(row => row.Id)
            .ToListAsync(cancellationToken);

        var transactions = await db.Transactions
            .AsNoTracking()
            .Where(row => row.Country == country && row.AccountId != null)
            .ToListAsync(cancellationToken);

        return Compute(loans, savings, transactions, DateOnly.FromDateTime(clock.GetLocalNow().DateTime));
    }

    /// <summary>The summary, from rows and a day. No database, no clock.</summary>
    public static FinanceSummary Compute(
        IReadOnlyList<Loan> loans,
        IReadOnlyList<SavingsRecord> savings,
        IReadOnlyList<TransactionRow> transactions,
        DateOnly today)
    {
        var activeLoans = loans.Where(loan => !loan.Archived).ToList();
        var activeSavings = savings.Where(saving => !saving.Archived).ToList();

        var loanRows = activeLoans.Select(loan => Summarise(loan, today)).ToList();
        var savingsRows = activeSavings.Select(saving => Summarise(saving, transactions, today)).ToList();

        var monthlyPayments = RoundCents(loanRows.Sum(row => (double)row.MonthlyPayment));
        var remaining = RoundCents(loanRows.Sum(row => (double)row.Remaining));
        var projected = RoundCents(savingsRows.Sum(row => (double)row.ProjectedNow));

        return new FinanceSummary(
            loanRows,
            savingsRows,
            new FinanceTotals(
                Money(monthlyPayments),
                Money(remaining),
                Money(projected),
                Money(RoundCents(projected - remaining))));
    }

    /// <summary>One loan: what is left of it, what it costs a month, and when it ends.</summary>
    private static LoanSummary Summarise(Loan loan, DateOnly today)
    {
        var schedule = Amortization(loan);
        var now = YearMonth(today);

        // The first month from now: its opening balance is what is still owed.
        var next = schedule.FirstOrDefault(row => string.CompareOrdinal(row.Date, now) >= 0);
        var remaining = next?.OpeningBalance ?? loan.Principal;

        var principal = (double)loan.Principal;
        var pctPaid = principal > 0 ? (int)RoundCents((principal - (double)remaining) / principal * 100) : 100;

        return new LoanSummary(
            loan.Id,
            loan.Name,
            loan.Color,
            loan.Apr,
            loan.Principal,
            Money((double)remaining),
            pctPaid,
            Money(Payment(loan)),
            schedule.Count > 0 ? schedule[^1].Date : "");
    }

    /// <summary>One savings account: what it should be worth by now.</summary>
    private static SavingsSummary Summarise(
        SavingsRecord saving,
        IReadOnlyList<TransactionRow> transactions,
        DateOnly today)
    {
        var elapsed = Math.Max(0, (today.Year - saving.StartDate.Year) * 12 + (today.Month - saving.StartDate.Month));

        var projected = saving.LinkedAccountId is { Length: > 0 } linked
            ? AccountNetBalance(transactions, linked)
            : (double)Projection(saving, elapsed)[^1].Balance;

        return new SavingsSummary(
            saving.Id,
            saving.Name,
            saving.Color,
            saving.Apr,
            saving.StartBalance,
            Money(projected),
            Money(RoundCents(projected - (double)saving.StartBalance)),
            saving.CompoundFreq);
    }

    /// <summary>
    /// The month-by-month schedule of a loan, the way a lender would print it: equal
    /// payments, interest on the outstanding balance, and the last payment taking whatever
    /// is left.
    /// </summary>
    public static List<AmortizationRow> Amortization(Loan loan)
    {
        // The schedule runs on the exact payment and only shows it rounded: running on the
        // rounded one leaves the last month a few cents short of nothing.
        var payment = ExactPayment(loan);
        var rate = (double)loan.Apr / 100 / 12;
        var balance = (double)loan.Principal;

        var rows = new List<AmortizationRow>(loan.TermMonths);

        for (var month = 1; month <= loan.TermMonths; month++)
        {
            var opening = balance;
            var interest = balance * rate;
            var principal = Math.Min(payment - interest, balance);
            balance = Math.Max(0, balance - principal);

            rows.Add(new AmortizationRow(
                month,
                YearMonth(loan.StartDate, month),
                Money(RoundCents(opening)),
                Money(RoundCents(payment)),
                Money(RoundCents(interest)),
                Money(RoundCents(principal)),
                Money(RoundCents(balance))));
        }

        return rows;
    }

    /// <summary>The equal monthly payment an annuity loan needs to clear in its term.</summary>
    public static double Payment(Loan loan) => RoundCents(ExactPayment(loan));

    private static double ExactPayment(Loan loan)
    {
        var rate = (double)loan.Apr / 100 / 12;
        var principal = (double)loan.Principal;
        var months = loan.TermMonths;

        if (months <= 0)
            return 0;

        if (rate <= 0)
            return principal / months;

        var growth = Math.Pow(1 + rate, months);

        return principal * rate * growth / (growth - 1);
    }

    /// <summary>A savings balance as it compounds, month by month from the day it started.</summary>
    public static List<ProjectionPoint> Projection(SavingsRecord saving, int months)
    {
        var periodsPerYear = saving.CompoundFreq switch
        {
            "monthly" => 12,
            "quarterly" => 4,
            "annually" => 1,
            _ => 12,
        };

        var ratePerPeriod = (double)saving.Apr / 100 / periodsPerYear;
        var periodsPerMonth = (double)periodsPerYear / 12;
        var start = (double)saving.StartBalance;

        return Enumerable.Range(0, Math.Max(0, months) + 1)
            .Select(month => new ProjectionPoint(
                YearMonth(saving.StartDate, month),
                Money(RoundCents(start * Math.Pow(1 + ratePerPeriod, month * periodsPerMonth)))))
            .ToList();
    }

    /// <summary>What the transactions on one account come to, which is a linked balance.</summary>
    private static double AccountNetBalance(IReadOnlyList<TransactionRow> transactions, string accountId) =>
        transactions
            .Where(row => row.AccountId == accountId)
            .Sum(row => row.Type == "in" ? (double)row.Amount : -(double)row.Amount);

    private static string YearMonth(DateOnly date, int months = 0)
    {
        var shifted = new DateOnly(date.Year, date.Month, 1).AddMonths(months);

        return $"{shifted.Year}-{shifted.Month:00}";
    }

    // JavaScript's Math.round: a half always goes up, and the money is rounded the same way
    // at the same points it was in the browser.
    private static double RoundCents(double value) => Math.Floor(value * 100 + 0.5) / 100;

    private static decimal Money(double value) => (decimal)value;
}

/// <summary>The loans and savings, as the pages that show them need them.</summary>
public sealed record FinanceSummary(
    IReadOnlyList<LoanSummary> Loans,
    IReadOnlyList<SavingsSummary> Savings,
    FinanceTotals Totals);

public sealed record LoanSummary(
    int Id,
    string Name,
    string Color,
    decimal Apr,
    decimal Principal,
    decimal Remaining,
    int PctPaid,
    decimal MonthlyPayment,
    string PayoffMonth);

public sealed record SavingsSummary(
    int Id,
    string Name,
    string Color,
    decimal Apr,
    decimal StartBalance,
    decimal ProjectedNow,
    decimal InterestEarned,
    string CompoundFreq);

public sealed record FinanceTotals(
    decimal MonthlyPayments,
    decimal LoanRemaining,
    decimal ProjectedSavings,
    decimal NetPosition);

public sealed record AmortizationRow(
    int Month,
    string Date,
    decimal OpeningBalance,
    decimal Payment,
    decimal InterestPaid,
    decimal PrincipalPaid,
    decimal ClosingBalance);

public sealed record ProjectionPoint(string Date, decimal Balance);
