using Folio.Api.Modules.Folio;

namespace Folio.Api.Tests;

/// <summary>
/// The demo budget, which is a rule rather than a page: which accounts a persona has, how
/// often a bill is paid, how much of the budget is really spent.
///
/// The randomness is a seeded one, so a test can make the same budget twice.
/// </summary>
public sealed class DemoDataTests
{
    private static DemoRequest Request(string? persona = "balanced", bool goals = true, bool finance = true) =>
        new(persona, 2025, 1, 2025, 12, 3500m, goals, finance);

    private static DemoWorkspace Generated(DemoRequest request, int seed = 7) =>
        DemoData.Generate(request, new Random(seed));

    [Theory]
    [InlineData("saver", 4)]
    [InlineData("balanced", 3)]
    [InlineData("indebted", 4)]
    public void Each_persona_has_the_accounts_it_is_known_for(string persona, int expected)
    {
        var demo = Generated(Request(persona));

        Assert.Equal(expected, demo.Accounts.Accounts!.Count);
        Assert.Equal(expected, demo.Result.AccountsCreated);
        Assert.Equal(expected, demo.Accounts.NextId!.Value - 10);
    }

    [Fact]
    public void The_first_account_is_the_one_salaries_are_paid_into()
    {
        var demo = Generated(Request());
        var checking = demo.Accounts.Accounts![0].Id;

        var salaries = demo.Transactions.Transactions!.Where(row => row.Name == "Salary").ToList();

        Assert.NotEmpty(salaries);
        Assert.All(salaries, salary => Assert.Equal(checking, salary.AccountId));
        Assert.All(salaries, salary => Assert.Equal("in", salary.Type));
    }

    [Fact]
    public void Every_month_of_the_period_gets_a_budget_and_two_salaries()
    {
        var demo = Generated(Request());
        var months = demo.Budget.MonthlyEntries!;

        Assert.Equal(12, demo.Result.BudgetMonths);
        Assert.Equal(12, months.Sum(year => year.Value.Count));

        foreach (var (year, byMonth) in months)
        {
            Assert.Equal("2025", year);

            foreach (var (_, entries) in byMonth)
                Assert.Equal(13, entries.Count);
        }

        // Two paychecks a month, and at least one payment for each of the thirteen lines.
        var salaries = demo.Transactions.Transactions!.Count(row => row.Name == "Salary");
        Assert.Equal(24, salaries);
        Assert.True(demo.Transactions.Transactions!.Count >= 12 * (2 + 13));
    }

    [Fact]
    public void A_paycheck_is_half_the_monthly_income()
    {
        var demo = Generated(Request());

        Assert.All(
            demo.Transactions.Transactions!.Where(row => row.Name == "Salary"),
            salary => Assert.Equal(1750m, salary.Amount));
    }

    [Fact]
    public void Every_transaction_is_dated_inside_the_period_and_costs_whole_cents()
    {
        var demo = Generated(Request());

        Assert.All(demo.Transactions.Transactions!, row =>
        {
            Assert.InRange(row.Date, new DateOnly(2025, 1, 1), new DateOnly(2025, 12, 31));
            Assert.Equal(row.Amount, Math.Round(row.Amount, 2));
            Assert.True(row.Amount > 0);
        });
    }

    [Fact]
    public void Transaction_ids_are_unique_and_the_counter_is_past_the_last_one()
    {
        var demo = Generated(Request());
        var ids = demo.Transactions.Transactions!.Select(row => row.Id).ToList();

        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.Equal(ids.Max() + 1, demo.Transactions.NextId);
        Assert.Equal(ids.Count, demo.Result.TransactionsAdded);
    }

    [Fact]
    public void A_fixed_bill_is_paid_once_a_month_from_the_current_account()
    {
        var demo = Generated(Request());
        var checking = demo.Accounts.Accounts![0].Id;

        foreach (var bill in new[] { "Rent / Mortgage", "Utilities", "Streaming" })
        {
            var rows = demo.Transactions.Transactions!.Where(row => row.Name == bill).ToList();

            Assert.Equal(12, rows.Count);
            Assert.All(rows, row => Assert.Equal(checking, row.AccountId));
        }
    }

    [Fact]
    public void Spending_that_is_not_a_fixed_bill_goes_on_the_card()
    {
        var demo = Generated(Request());
        var card = demo.Accounts.Accounts!.First(account => account.Type == "liability").Id;

        var groceries = demo.Transactions.Transactions!.Where(row => row.Name == "Groceries").ToList();

        Assert.NotEmpty(groceries);
        Assert.All(groceries, row => Assert.Equal(card, row.AccountId));
    }

    [Fact]
    public void Every_expense_is_attached_to_the_budget_line_it_belongs_to()
    {
        var demo = Generated(Request());
        var byName = demo.Budget.GlobalItems!.ToDictionary(item => item.Name, item => item.Id);

        Assert.All(
            demo.Transactions.Transactions!.Where(row => row.Type == "out"),
            row => Assert.Equal(byName[row.Name], row.ItemId));
    }

    [Fact]
    public void The_template_holds_the_same_thirteen_lines_as_the_month()
    {
        var demo = Generated(Request());

        Assert.Equal(13, demo.Template.Entries!.Count);
        Assert.Equal(demo.Budget.GlobalItems!.Count, demo.Template.Entries!.Count);
        Assert.All(demo.Template.Entries!, entry => Assert.Contains(entry, demo.Budget.MonthlyEntries!["2025"]["1"]));
    }

    [Fact]
    public void An_indebted_persona_spends_more_of_its_income_than_a_saver()
    {
        static decimal Spent(DemoWorkspace demo) =>
            demo.Transactions.Transactions!.Where(row => row.Type == "out").Sum(row => row.Amount);

        var saver = Spent(Generated(Request("saver")));
        var indebted = Spent(Generated(Request("indebted")));

        Assert.True(indebted > saver * 2, $"expected the indebted persona to spend clearly more, got {saver} and {indebted}");
    }

    [Fact]
    public void A_savings_goal_opens_a_month_before_the_period_and_contributes_each_month()
    {
        var demo = Generated(Request());
        var emergency = demo.SavingsGoals.Goals!.Single(goal => goal.Name == "Emergency Fund");

        Assert.Equal(2, demo.Result.GoalsCreated);
        Assert.Equal(10000m, emergency.TargetAmount);
        Assert.Equal(3, demo.SavingsGoals.NextGoalId);
        Assert.Equal(13, emergency.Contributions!.Count);   // one opening contribution and twelve months

        var opening = emergency.Contributions!.Single(contribution => contribution.Note == "Opening balance");
        Assert.Equal(new DateOnly(2024, 12, 28), opening.Date);
        Assert.Equal(4500m, opening.Amount);

        // The site shows contributions newest-first.
        Assert.Equal(
            emergency.Contributions!.OrderByDescending(contribution => contribution.Date).Select(contribution => contribution.Id),
            emergency.Contributions!.Select(contribution => contribution.Id));
    }

    [Fact]
    public void Goals_and_finance_can_both_be_left_out()
    {
        var demo = Generated(Request(goals: false, finance: false));

        Assert.Empty(demo.SavingsGoals.Goals!);
        Assert.Empty(demo.Finance.Loans!);
        Assert.Empty(demo.Finance.Savings!);
        Assert.Equal(0, demo.Result.GoalsCreated);
        Assert.Equal(0, demo.Result.LoansCreated);
        Assert.Equal(0, demo.Result.FinanceSavingsCreated);

        // The budget itself is unaffected.
        Assert.Equal(13, demo.Budget.GlobalItems!.Count);
        Assert.NotEmpty(demo.Transactions.Transactions!);
    }

    [Fact]
    public void A_loan_started_before_the_period_is_dated_from_the_month_it_started()
    {
        var demo = Generated(Request("balanced"));
        var loan = demo.Finance.Loans!.Single();

        Assert.Equal("Car Loan", loan.Name);
        Assert.Equal(18000m, loan.Principal);
        Assert.Equal(new DateOnly(2023, 1, 1), loan.StartDate);   // twenty-four months before January 2025
        Assert.Equal(2, demo.Finance.NextLoanId);
    }

    [Fact]
    public void A_savings_account_starts_at_a_multiple_of_the_income()
    {
        var demo = Generated(Request("saver"));
        var savings = demo.Finance.Savings!.Single();

        Assert.Equal(18 * 3500m, savings.StartBalance);
        Assert.Equal("monthly", savings.CompoundFreq);
        Assert.Equal(new DateOnly(2023, 1, 1), savings.StartDate);
    }

    [Fact]
    public void The_same_seed_makes_the_same_budget_and_another_seed_does_not()
    {
        static string Amounts(DemoWorkspace demo) =>
            string.Join(",", demo.Transactions.Transactions!.Select(row => row.Amount));

        Assert.Equal(Amounts(Generated(Request(), 11)), Amounts(Generated(Request(), 11)));
        Assert.NotEqual(Amounts(Generated(Request(), 11)), Amounts(Generated(Request(), 12)));
    }

    [Fact]
    public void A_period_that_is_not_whole_years_is_counted_in_months()
    {
        var demo = Generated(new DemoRequest("balanced", 2025, 11, 2026, 2, 3000m, false, false));

        Assert.Equal(4, demo.Result.BudgetMonths);
        Assert.Equal(4, demo.Budget.MonthlyEntries!["2025"].Count + demo.Budget.MonthlyEntries!["2026"].Count);
        Assert.All(
            demo.Transactions.Transactions!,
            row => Assert.InRange(row.Date, new DateOnly(2025, 11, 1), new DateOnly(2026, 2, 28)));
    }

    [Fact]
    public void A_persona_that_is_not_named_falls_back_to_the_balanced_one()
    {
        Assert.Null(DemoData.Refusal(new DemoRequest(null, 2025, 1, 2025, 1, 3000m, false, false)));

        var demo = Generated(new DemoRequest(null, 2025, 1, 2025, 1, 3000m, false, false));

        Assert.Equal("Checking Account", demo.Accounts.Accounts![0].Name);
    }

    [Theory]
    [InlineData("spendthrift", 3500, 2025, 1, 2025, 12, "saver, balanced, indebted")]
    [InlineData("balanced", 50, 2025, 1, 2025, 12, "100 and 999999")]
    [InlineData("balanced", 3500, 2025, 6, 2025, 2, "one to 120 months")]
    [InlineData("balanced", 3500, 2020, 1, 2030, 12, "one to 120 months")]
    [InlineData("balanced", 3500, 2025, 13, 2025, 12, "1 to 12")]
    [InlineData("balanced", 3500, 1990, 1, 1991, 1, "2000 and 2100")]
    public void An_impossible_request_is_refused_with_a_reason(
        string persona, decimal income, int startYear, int startMonth, int endYear, int endMonth, string because)
    {
        var refusal = DemoData.Refusal(new DemoRequest(persona, startYear, startMonth, endYear, endMonth, income, true, true));

        Assert.NotNull(refusal);
        Assert.Contains(because, refusal, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void A_period_of_a_hundred_and_twenty_months_is_allowed()
    {
        Assert.Null(DemoData.Refusal(new DemoRequest("balanced", 2016, 1, 2025, 12, 3000m, false, false)));
        Assert.NotNull(DemoData.Refusal(new DemoRequest("balanced", 2016, 1, 2026, 1, 3000m, false, false)));
    }
}
