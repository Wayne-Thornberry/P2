using Folio.Api.Modules.Folio;

namespace Folio.Api.Tests;

/// <summary>
/// The health score, without a database or a clock in the way.
///
/// The score is a pure function of saved rows and a day, so these tests hand it both and
/// check the answer: the bands, the parts it is made of, and the cases where there is no
/// budget to measure against.
/// </summary>
public sealed class HealthScoreTests
{
    /// <summary>Standing in the middle of November 2026, so the window is May..October.</summary>
    private static readonly DateOnly Today = new(2026, 11, 15);

    private static TransactionRow In(int month, decimal amount, int? itemId = null) =>
        new() { Country = "ireland", Type = "in", Amount = amount, Date = new DateOnly(2026, month, 10), ItemId = itemId };

    private static TransactionRow Out(int month, decimal amount, int? itemId = null) =>
        new() { Country = "ireland", Type = "out", Amount = amount, Date = new DateOnly(2026, month, 10), ItemId = itemId };

    private static HealthReport Score(IEnumerable<TransactionRow> rows, params BudgetLine[] lines) =>
        HealthService.Compute(rows.ToList(), lines, 1, Today, null);

    [Fact]
    public void Savings_are_measured_over_the_three_completed_months()
    {
        var report = Score(
        [
            In(8, 1000), Out(8, 700),
            In(9, 1000), Out(9, 700),
            In(10, 1000), Out(10, 700),
        ]);

        Assert.Equal(30, report.Rolling3.SavingsRate);
        Assert.Equal(1000m, report.Rolling3.Income);
        Assert.Equal(700m, report.Rolling3.Expenses);
    }

    [Fact]
    public void The_month_being_lived_is_left_out()
    {
        var report = Score(
        [
            In(9, 1000), Out(9, 900),
            In(10, 1000), Out(10, 900),

            // November is not finished, so its income cannot flatter the score.
            In(11, 50_000),
        ]);

        Assert.Equal(1000m, report.Rolling3.Income);
        Assert.Equal(10, report.Rolling3.SavingsRate);
    }

    [Fact]
    public void A_month_with_no_income_or_spending_is_left_out_of_the_average()
    {
        var report = Score(
        [
            In(10, 1000), Out(10, 500),
        ]);

        // Only one of the three months had anything in it, so the average is that month.
        Assert.Equal(1000m, report.Rolling3.Income);
        Assert.Equal(500m, report.Rolling3.Expenses);
        Assert.Equal(1, report.IncomeConsistency);
    }

    [Fact]
    public void The_emergency_reserve_is_the_balance_in_months_of_spending()
    {
        var report = Score(
        [
            In(8, 1000), Out(8, 500),
            In(9, 1000), Out(9, 500),
            In(10, 1000), Out(10, 500),
        ]);

        // 1500 saved across those months over 500 a month of spending: three months.
        Assert.Equal(3m, report.ReserveMonths);
    }

    [Fact]
    public void A_profit_with_no_spending_has_no_reserve_figure()
    {
        var report = Score([In(10, 1000)]);

        Assert.Null(report.ReserveMonths);
    }

    [Fact]
    public void Adherence_counts_the_budget_lines_that_were_not_overspent()
    {
        var report = Score(
        [
            Out(10, 120, itemId: 1),
            Out(10, 80, itemId: 2),
        ],
        new BudgetLine(1, 100),
        new BudgetLine(2, 100),
        new BudgetLine(3, 100));

        Assert.NotNull(report.BudgetAdherence);
        Assert.Equal(3, report.BudgetAdherence!.Total);
        Assert.Equal(1, report.BudgetAdherence.Over);
        Assert.Equal(2, report.BudgetAdherence.OnTrack);
        Assert.Equal(67, report.BudgetAdherence.Pct);
    }

    [Fact]
    public void With_no_budget_the_score_is_scaled_from_eighty()
    {
        var report = Score(
        [
            // July is in the window but not in the three months the rate uses, so it
            // raises the balance without changing the savings rate.
            In(7, 3_300),

            In(8, 1000), Out(8, 700),
            In(9, 1000), Out(9, 700),
            In(10, 1000), Out(10, 700),
        ]);

        Assert.Null(report.BudgetAdherence);
        Assert.Equal(6m, report.ReserveMonths);

        // 35 for savings, 30 for six months of reserve, 15 for three months of income:
        // 80 of the 80 a budget-less month can earn, which scales to 100.
        Assert.Equal(100, report.Score);
        Assert.Equal("A", report.Grade.Letter);
    }

    [Fact]
    public void Nothing_saved_at_all_still_answers()
    {
        var report = Score([]);

        // No savings, no reserve and no income leave only the eight points that "not
        // overspending" is worth, out of the 80 a budget-less month can earn.
        Assert.Equal(10, report.Score);
        Assert.Equal("F", report.Grade.Letter);
        Assert.Equal("Critical", report.Grade.Label);
    }

    [Fact]
    public void The_grade_follows_the_score()
    {
        Assert.Equal("A", HealthService.GradeOf(90).Letter);
        Assert.Equal("B", HealthService.GradeOf(76).Letter);
        Assert.Equal("C", HealthService.GradeOf(55).Letter);
        Assert.Equal("D", HealthService.GradeOf(40).Letter);
        Assert.Equal("F", HealthService.GradeOf(39).Letter);

        Assert.Equal("Excellent", HealthService.GradeOf(100).Label);
        Assert.Equal("Critical", HealthService.GradeOf(0).Label);
    }
}
