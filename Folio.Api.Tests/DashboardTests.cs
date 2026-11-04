using Folio.Api.Modules.Folio;

namespace Folio.Api.Tests;

/// <summary>
/// The Dashboard's numbers, without a database or a clock in the way.
///
/// The dashboard is four rules wearing a page: which accounts the budget ignores, which
/// month a transaction belongs to, what a spending line groups by, and how a budget line's
/// progress is capped. Each of them is checked here against rows built by hand.
/// </summary>
public sealed class DashboardTests
{
    private static readonly DateOnly November = new(2026, 11, 1);

    private static TransactionRow Row(
        int id,
        string name,
        int month,
        decimal amount,
        string type,
        string? account = "acc-1",
        int? itemId = null,
        int day = 10,
        int year = 2026) =>
        new()
        {
            Country = "ireland",
            Id = id,
            Name = name,
            Date = new DateOnly(year, month, day),
            CreatedAt = new DateTime(year, month, day, 12, 0, 0),
            Amount = amount,
            Type = type,
            AccountId = account,
            ItemId = itemId,
        };

    private static Account Account(string id, string name, string type = "asset", bool? exclude = null, bool archived = false) =>
        new() { Country = "ireland", Id = id, Name = name, Type = type, ExcludeFromBudget = exclude, Archived = archived };

    private static DashboardReport Report(
        IReadOnlyList<TransactionRow> rows,
        IReadOnlyList<Account>? accounts = null,
        IReadOnlyList<BudgetLine>? lines = null,
        IReadOnlyDictionary<int, string>? names = null) =>
        DashboardService.Compute(
            rows,
            accounts ?? [Account("acc-1", "Everyday")],
            lines ?? [],
            names ?? new Dictionary<int, string>(),
            1,
            November,
            November);

    [Fact]
    public void The_month_totals_add_up_what_was_spent_and_earned()
    {
        var report = Report(
        [
            Row(1, "Salary", 11, 3200, "in"),
            Row(2, "Rent", 11, 1450, "out"),
            Row(3, "Tesco", 11, 73.28m, "out"),

            // December is another month's business.
            Row(4, "Salary", 12, 3200, "in"),
        ]);

        Assert.Equal(3200m, report.Totals.Income);
        Assert.Equal(1523.28m, report.Totals.Expenses);
        Assert.Equal(1676.72m, report.Totals.Net);
        Assert.Equal(52, report.Totals.SavingsRate);
        Assert.Equal(1, report.Totals.IncomeCount);
        Assert.Equal(2, report.Totals.ExpenseCount);
    }

    [Fact]
    public void A_month_with_no_income_saves_nothing_rather_than_dividing_by_zero()
    {
        var report = Report([Row(1, "Tesco", 11, 20, "out")]);

        Assert.Equal(0, report.Totals.SavingsRate);
        Assert.Equal(-20m, report.Totals.Net);
    }

    [Fact]
    public void The_budget_ignores_liabilities_archived_accounts_and_whatever_says_so()
    {
        var report = Report(
        [
            Row(1, "Salary", 11, 1000, "in", account: "acc-1"),
            Row(2, "Card payment", 11, 300, "out", account: "card"),
            Row(3, "Old account", 11, 50, "out", account: "old"),
            Row(4, "Holiday fund", 11, 200, "out", account: "holiday"),
        ],
        [
            Account("acc-1", "Everyday"),
            Account("card", "Credit Card", type: "liability"),
            Account("old", "Closed", archived: true),
            Account("holiday", "Holiday", exclude: true),
        ]);

        // Only the everyday account counts towards what the month came to.
        Assert.Equal(1000m, report.Totals.Income);
        Assert.Equal(0m, report.Totals.Expenses);
    }

    [Fact]
    public void Every_account_keeps_its_balance_and_money_with_no_account_gets_a_line()
    {
        var report = Report(
        [
            Row(1, "Salary", 11, 1000, "in", account: "acc-1"),
            Row(2, "Rent", 11, 400, "out", account: "acc-1"),
            Row(3, "Cash", 11, 25, "out", account: null),
        ],
        [Account("acc-1", "Everyday"), Account("acc-2", "Savings", type: "savings")]);

        Assert.Equal(600m, report.Accounts.Single(row => row.Id == "acc-1").Balance);
        Assert.Equal(0m, report.Accounts.Single(row => row.Id == "acc-2").Balance);
        Assert.Equal(-25m, report.Accounts.Single(row => row.Id == "__unassigned__").Balance);
    }

    [Fact]
    public void A_spending_line_is_every_transaction_with_the_same_name()
    {
        var report = Report(
        [
            Row(1, "Tesco", 11, 73.28m, "out"),
            Row(2, "Tesco", 11, 84.12m, "out"),
            Row(3, "Rent", 11, 1450, "out"),
            Row(4, "Salary", 11, 3200, "in"),
        ]);

        Assert.Equal(2, report.TopSpending.Count);
        Assert.Equal("Rent", report.TopSpending[0].Name);
        Assert.Equal(1450m, report.TopSpending[0].Total);
        Assert.Equal("Tesco", report.TopSpending[1].Name);
        Assert.Equal(157.40m, report.TopSpending[1].Total);
    }

    [Fact]
    public void A_refund_lands_back_in_its_envelope()
    {
        var report = Report(
        [
            Row(1, "Tesco", 11, 100, "out", itemId: 1),
            Row(2, "Tesco refund", 11, 30, "in", itemId: 1),
        ],
        lines: [new BudgetLine(1, 120m)],
        names: new Dictionary<int, string> { [1] = "Groceries" });

        var row = Assert.Single(report.Budget!.TopRows);

        Assert.Equal("Groceries", row.Name);
        Assert.Equal(70m, row.Activity);
        Assert.Equal(50m, row.Available);
        Assert.Equal(58, row.Pct);
    }

    [Fact]
    public void A_budget_line_that_is_over_is_counted_once_and_capped_at_a_hundred_per_cent()
    {
        var report = Report(
        [
            Row(1, "Rent", 11, 200, "out", itemId: 1),
            Row(2, "Tesco", 11, 10, "out", itemId: 2),
        ],
        lines: [new BudgetLine(1, 100m), new BudgetLine(2, 100m), new BudgetLine(3, 50m)],
        names: new Dictionary<int, string> { [1] = "Rent", [2] = "Groceries", [3] = "Petrol" });

        var budget = report.Budget!;

        Assert.Equal(250m, budget.TotalAssigned);
        Assert.Equal(210m, budget.TotalActivity);
        Assert.Equal(1, budget.OverCount);
        Assert.Equal(2, budget.OnTrack);
        Assert.Equal(84, budget.OverallPct);

        // The overspent line comes first, and its bar stops at 100%.
        Assert.Equal("Rent", budget.TopRows[0].Name);
        Assert.Equal(100, budget.TopRows[0].Pct);
    }

    [Fact]
    public void No_budget_at_all_is_null_rather_than_a_page_of_zeroes()
    {
        var report = Report([Row(1, "Tesco", 11, 20, "out")]);

        Assert.Null(report.Budget);
    }

    [Fact]
    public void The_recent_list_is_the_newest_first()
    {
        var report = Report(
        [
            Row(1, "Older", 11, 10, "out", day: 1),
            Row(2, "Newer", 11, 10, "out", day: 20),
            Row(3, "Newest", 11, 10, "out", day: 25),
        ]);

        Assert.Equal(["Newest", "Newer", "Older"], report.Recent.Select(row => row.Name));
    }

    [Fact]
    public void A_budget_month_that_starts_mid_month_claims_the_days_it_owns()
    {
        // A budget that starts on the 25th: the 25th onwards belongs to the next month, so
        // the 26th of November and the 2nd of December are both November's business.
        var rows = new[]
        {
            Row(1, "Rent", 11, 500, "out", itemId: 1, day: 26),
            Row(2, "Rent", 12, 700, "out", itemId: 1, day: 2),
        };

        var lines = new[] { new BudgetLine(1, 1000m) };
        var names = new Dictionary<int, string> { [1] = "Rent" };
        var accounts = new[] { Account("acc-1", "Everyday") };

        var november = DashboardService.Compute(rows, accounts, lines, names, 25, new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 1));
        var december = DashboardService.Compute(rows, accounts, lines, names, 25, new DateOnly(2026, 12, 1), new DateOnly(2026, 12, 1));

        Assert.Equal(1200m, november.Budget!.TopRows[0].Activity);
        Assert.Equal(0m, december.Budget!.TopRows[0].Activity);
    }
}
