using Folio.Api.Modules.Folio;

namespace Folio.Api.Tests;

/// <summary>
/// The loans and savings accounts, without a database or a clock in the way.
///
/// An amortisation schedule is the kind of arithmetic that looks right and is a penny out:
/// these pin the payment, the first months of the schedule, and the point at which a linked
/// account's balance is what a savings record is worth instead of a projection.
/// </summary>
public sealed class FinanceTests
{
    private static readonly DateOnly Today = new(2026, 11, 15);

    private static Loan LoanStarted(decimal principal, decimal apr, int months, int startYear = 2026, int startMonth = 1) =>
        new()
        {
            Country = "ireland",
            Id = 1,
            Name = "Car loan",
            Principal = principal,
            Apr = apr,
            TermMonths = months,
            StartDate = new DateOnly(startYear, startMonth, 1),
            Color = "#ef4444",
        };

    private static SavingsRecord SavingsStarted(decimal balance, decimal apr, string freq, int startYear = 2026, int startMonth = 1) =>
        new()
        {
            Country = "ireland",
            Id = 1,
            Name = "Rainy day",
            Apr = apr,
            CompoundFreq = freq,
            StartBalance = balance,
            StartDate = new DateOnly(startYear, startMonth, 1),
            Color = "#10b981",
        };

    [Fact]
    public void The_monthly_payment_is_the_annuity_payment()
    {
        // 10,000 at 5% over a year: the textbook payment is 856.07.
        Assert.Equal(856.07m, FinanceService.Amortization(LoanStarted(10_000m, 5m, 12))[0].Payment);
    }

    [Fact]
    public void A_loan_at_no_interest_is_the_principal_split_evenly()
    {
        var schedule = FinanceService.Amortization(LoanStarted(1_200m, 0m, 12));

        Assert.Equal(100m, schedule[0].Payment);
        Assert.Equal(0m, schedule[0].InterestPaid);
        Assert.Equal(1_200m, schedule[0].OpeningBalance);
        Assert.Equal(1_100m, schedule[0].ClosingBalance);
        Assert.Equal(0m, schedule[^1].ClosingBalance);
    }

    [Fact]
    public void The_schedule_runs_one_row_per_month_and_ends_at_nothing()
    {
        var schedule = FinanceService.Amortization(LoanStarted(10_000m, 5m, 12));

        Assert.Equal(12, schedule.Count);
        Assert.Equal("2026-02", schedule[0].Date);
        Assert.Equal("2027-01", schedule[^1].Date);
        Assert.Equal(0m, schedule[^1].ClosingBalance);

        // Interest on 10,000 at 5% for one month, and the rest of the payment is principal.
        // Each figure is rounded on its own, so payment minus interest is a penny off the
        // principal column -- which is how the row reads in the browser too.
        Assert.Equal(41.67m, schedule[0].InterestPaid);
        Assert.Equal(814.41m, schedule[0].PrincipalPaid);
    }

    [Fact]
    public void What_is_owed_is_the_opening_balance_of_the_month_we_are_in()
    {
        // Started in January, so by November ten payments have been made.
        var summary = FinanceService.Compute([LoanStarted(10_000m, 5m, 24)], [], [], Today);

        var loan = Assert.Single(summary.Loans);

        Assert.Equal(438.71m, loan.MonthlyPayment);
        Assert.True(loan.Remaining < 10_000m, "some of it has been paid off");
        Assert.True(loan.PctPaid > 0 && loan.PctPaid < 100, "and it is not finished");
        Assert.Equal("2028-01", loan.PayoffMonth);
    }

    [Fact]
    public void A_loan_whose_term_has_passed_still_reports_its_principal()
    {
        // The card has no schedule row left to read, so it falls back to the amount
        // borrowed. That is what the page did before the API answered it, and copying the
        // answer is the point of moving it; changing it is a decision for the page.
        var summary = FinanceService.Compute([LoanStarted(10_000m, 5m, 6, startYear: 2025, startMonth: 1)], [], [], Today);

        var loan = Assert.Single(summary.Loans);

        Assert.Equal(10_000m, loan.Remaining);
        Assert.Equal(0, loan.PctPaid);
    }

    [Fact]
    public void An_archived_loan_is_left_out_of_the_totals()
    {
        var archived = LoanStarted(10_000m, 5m, 12);
        archived.Archived = true;

        var summary = FinanceService.Compute([archived], [], [], Today);

        Assert.Empty(summary.Loans);
        Assert.Equal(0m, summary.Totals.LoanRemaining);
    }

    [Fact]
    public void Savings_compound_at_the_frequency_they_say()
    {
        var monthly = FinanceService.Projection(SavingsStarted(1_000m, 12m, "monthly"), 12);
        var annually = FinanceService.Projection(SavingsStarted(1_000m, 12m, "annually"), 12);

        Assert.Equal(13, monthly.Count);
        Assert.Equal(1_000m, monthly[0].Balance);

        // 12% a year compounded monthly beats the same rate compounded once.
        Assert.Equal(1_126.83m, monthly[^1].Balance);
        Assert.Equal(1_120m, annually[^1].Balance);
    }

    [Fact]
    public void A_savings_account_linked_to_one_keeps_the_accounts_balance()
    {
        var saving = SavingsStarted(1_000m, 12m, "monthly");
        saving.LinkedAccountId = "acc-2";

        var summary = FinanceService.Compute(
            [],
            [saving],
            [
                new TransactionRow { Country = "ireland", Id = 1, Type = "in", Amount = 900m, AccountId = "acc-2", Date = Today },
                new TransactionRow { Country = "ireland", Id = 2, Type = "out", Amount = 150m, AccountId = "acc-2", Date = Today },
                new TransactionRow { Country = "ireland", Id = 3, Type = "in", Amount = 500m, AccountId = "acc-1", Date = Today },
            ],
            Today);

        var row = Assert.Single(summary.Savings);

        // The account says 750, and what it says is what the record is worth.
        Assert.Equal(750m, row.ProjectedNow);
        Assert.Equal(-250m, row.InterestEarned);
    }

    [Fact]
    public void The_totals_are_the_sum_of_what_is_left_and_what_is_projected()
    {
        var summary = FinanceService.Compute(
            [LoanStarted(10_000m, 5m, 12, startYear: 2026, startMonth: 11)],
            [SavingsStarted(2_000m, 0m, "monthly", startYear: 2026, startMonth: 11)],
            [],
            Today);

        Assert.Equal(856.07m, summary.Totals.MonthlyPayments);
        Assert.Equal(10_000m, summary.Totals.LoanRemaining);
        Assert.Equal(2_000m, summary.Totals.ProjectedSavings);
        Assert.Equal(-8_000m, summary.Totals.NetPosition);
    }
}
