using Folio.Api.Modules.Folio;

namespace Folio.Api.Tests;

/// <summary>
/// The rules behind the two AI features, without a model in the way: the numbers a report
/// is allowed to talk about, the reading of an answer that is not quite right, and the
/// guards that keep a muddled answer from writing something the budget would not want.
/// </summary>
public sealed class AiRulesTests
{
    private static readonly DateOnly First = new(2026, 1, 1);
    private static readonly DateOnly Last = new(2026, 3, 31);

    // ── the facts ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void The_facts_are_the_budgets_own_arithmetic()
    {
        var facts = AnalysisService.FactsOf(
            Rows(),
            [new Account { Id = "acc-1", Name = "Current" }],
            [new BudgetItem { Id = 1, Name = "Groceries" }, new BudgetItem { Id = 2, Name = "Coffee" }],
            [new BudgetAssignment { Year = 2026, Month = 3, ItemId = 1, Assigned = 100m, Category = "Food" }],
            First,
            Last,
            [],
            "EUR");

        Assert.Equal(1000m, facts.Totals.In);
        Assert.Equal(420m, facts.Totals.Out);
        Assert.Equal(580m, facts.Totals.Net);

        // 58% of what came in was kept: the same figure the health score would use.
        Assert.Equal(58m, facts.Totals.SavingsRate);

        // Three months in the window, whether or not each has a row.
        Assert.Equal(3, facts.Months.Count);
        Assert.Equal(150m, facts.Months[2].Out);

        // Groceries is 370 of the 420 that went out.
        Assert.Equal("Groceries", facts.Categories[0].Name);
        Assert.Equal(370m, facts.Categories[0].Spent);
        Assert.Equal(88.1m, facts.Categories[0].Share);

        // March's assignment was 100 and March spent 150 on it.
        Assert.Equal(1, facts.Budget.OverBudgetItems);
        Assert.Equal(50m, facts.Budget.Overspending[0].Over);

        // The same payee in three months is a bill rather than a one-off.
        Assert.Contains(facts.Recurring, entry => entry.Name == "Tesco" && entry.Months == 3);

        // The account is named, not left as an id, because the report quotes it.
        Assert.Equal("Current", facts.Accounts[0].Name);
    }

    [Fact]
    public void A_report_with_nothing_behind_it_says_so_in_numbers_rather_than_nothing()
    {
        var facts = AnalysisService.FactsOf([], [], [], [], First, Last, [], "EUR");

        // An empty budget is a report about zero, not a divide by zero.
        Assert.Equal(0m, facts.Totals.SavingsRate);
        Assert.Empty(facts.Categories);
        Assert.All(facts.Months, month => Assert.Equal(0m, month.Out));
    }

    // ── reading the answer ─────────────────────────────────────────────────────────────

    [Fact]
    public void A_report_is_read_as_the_page_renders_it()
    {
        var (report, problem) = AnalysisService.ReportFrom("""
            {
              "headline": "Groceries leads.",
              "summary": "Out ran ahead of in.",
              "findings": [
                { "title": "Groceries", "detail": "370 of 420.", "severity": "HIGH" },
                { "detail": "no title, so nothing to show" }
              ],
              "patterns": [ "Saturdays.", "", null ],
              "risks": null,
              "actions": [ "Cap groceries." ]
            }
            """);

        Assert.Null(problem);
        Assert.Equal("Groceries leads.", report!.Headline);

        // A severity the model made up is the middle one, and a finding with no title is
        // dropped rather than rendered as an empty card.
        Assert.Single(report.Findings);
        Assert.Equal("high", report.Findings[0].Severity);
        Assert.Single(report.Patterns);
        Assert.Equal("Saturdays.", report.Patterns[0]);
        Assert.Empty(report.Risks);
    }

    [Theory]
    [InlineData("not JSON at all")]
    [InlineData("{}")]
    [InlineData("""{"headline": "  ", "summary": ""}""")]
    public void An_answer_that_is_not_a_report_is_refused(string answer)
    {
        var (report, problem) = AnalysisService.ReportFrom(answer);

        Assert.Null(report);
        Assert.NotNull(problem);
    }

    // ── reading the categorising answer ────────────────────────────────────────────────

    [Fact]
    public void An_assignment_is_matched_to_the_item_by_its_name_however_it_is_spelt()
    {
        var (assignments, newItems, unmatched) = CategoriseService.FromAnswer(
            """{ "assignments": [ { "id": 7, "item": "eating out", "new": false, "confidence": 0.9 } ] }""",
            Candidates(7),
            [new BudgetItemDto(3202, "Eating Out")]);

        Assert.Equal(3202, assignments.Single().ItemId);
        Assert.Equal("Eating Out", assignments.Single().ItemName);
        Assert.False(assignments.Single().IsNew);
        Assert.Empty(newItems);
        Assert.Empty(unmatched);
    }

    [Fact]
    public void A_new_item_is_only_one_the_answer_says_it_is_inventing()
    {
        var (assignments, newItems, unmatched) = CategoriseService.FromAnswer(
            """
            {
              "assignments": [
                { "id": 7, "item": "Subscriptions", "new": true, "confidence": 2 },
                { "id": 8, "item": "Holidays", "new": false, "confidence": 0.4 }
              ]
            }
            """,
            Candidates(7, 8),
            []);

        // Inventing is allowed where it was flagged; a name nothing matches and the model
        // did not call new is left alone rather than quietly added.
        Assert.Single(assignments);
        Assert.Equal("Subscriptions", assignments[0].ItemName);
        Assert.Equal(1m, assignments[0].Confidence);
        Assert.Equal(["Subscriptions"], newItems);
        Assert.Equal([8], unmatched);
    }

    [Fact]
    public void An_id_nobody_asked_about_and_a_second_answer_for_the_same_row_are_both_dropped()
    {
        var (assignments, _, unmatched) = CategoriseService.FromAnswer(
            """
            {
              "assignments": [
                { "id": 999, "item": "Groceries", "new": false },
                { "id": 7, "item": "Groceries", "new": false },
                { "id": 7, "item": "Coffee", "new": false }
              ]
            }
            """,
            Candidates(7),
            [new BudgetItemDto(1, "Groceries"), new BudgetItemDto(2, "Coffee")]);

        Assert.Single(assignments);
        Assert.Equal("Groceries", assignments[0].ItemName);
        Assert.Empty(unmatched);
    }

    [Fact]
    public void A_budget_can_only_grow_by_so_many_items_in_one_answer()
    {
        var count = CategoriseService.MaxNewItems + 4;

        var assignments = Enumerable.Range(1, count)
            .Select(id => $$"""{ "id": {{id}}, "item": "Item {{id}}", "new": true }""")
            .ToList();

        var (kept, newItems, _) = CategoriseService.FromAnswer(
            $$"""{ "assignments": [ {{string.Join(", ", assignments)}} ] }""",
            Candidates([.. Enumerable.Range(1, count)]),
            []);

        Assert.Equal(CategoriseService.MaxNewItems, newItems.Count);
        Assert.Equal(CategoriseService.MaxNewItems, kept.Count(row => row.IsNew));
    }

    // ── fixtures ───────────────────────────────────────────────────────────────────────

    private static List<TransactionRow> Rows() =>
    [
        Spending(1, "Tesco", new DateOnly(2026, 1, 5), 100m, itemId: 1),
        Spending(2, "Coffee", new DateOnly(2026, 1, 6), 50m, itemId: 2),
        Spending(3, "Tesco", new DateOnly(2026, 2, 5), 120m, itemId: 1),
        Spending(4, "Tesco", new DateOnly(2026, 3, 5), 150m, itemId: 1),
        new TransactionRow
        {
            Id = 5,
            Name = "Salary",
            Date = new DateOnly(2026, 1, 1),
            Amount = 1000m,
            Type = "in",
            AccountId = "acc-1",
        },
    ];

    private static TransactionRow Spending(int id, string name, DateOnly date, decimal amount, int itemId) => new()
    {
        Id = id,
        Name = name,
        Date = date,
        Amount = amount,
        Type = "out",
        ItemId = itemId,
        AccountId = "acc-1",
    };

    private static List<CategoriseCandidate> Candidates(params int[] ids) =>
        [.. ids.Select(id => new CategoriseCandidate(id, $"Transaction {id}", "", 10m, "out", "2026-01-01"))];
}
