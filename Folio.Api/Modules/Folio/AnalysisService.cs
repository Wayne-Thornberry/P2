using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Folio.Api.Ai;
using Folio.Api.Auth;
using Folio.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Modules.Folio;

/// <summary>
/// A written report on somebody's spending, with the numbers it was written from.
///
/// The split matters: <b>the API works the facts out</b> — every total, average, share and
/// comparison in the answer is arithmetic over saved rows, and a test can check it without
/// a model — and <b>DeepSeek writes the reading of them</b>: what stands out, what looks
/// like a habit, what is worth changing. A model asked to add up a year of transactions
/// would be a model guessing at arithmetic; this one is asked only about numbers that are
/// already right.
/// </summary>
public sealed class AnalysisService(FolioDbContext db, CurrentUser me, DeepSeekClient ai, TimeProvider clock)
{
    /// <summary>Months a report may cover. A year is the default; five is the ceiling.</summary>
    public const int MaxMonths = 60;

    public const int DefaultMonths = 12;

    /// <summary>What the model is asked for: JSON, in this shape, and nothing else.</summary>
    private const string SystemPrompt = """
        You are a careful personal-finance analyst. The user gives you JSON: facts already
        computed from their own budget, and nothing else. Read them and say what they mean.

        Rules:
        - Use only the numbers given. Never invent a figure, a merchant, a category or a date.
        - Quote figures exactly as they appear (same currency, same rounding).
        - Comparing a month to the average, a category to its budget, or one account to
          another is what the user wants; say which is which.
        - Be concrete and specific. "Eating out is 18% of spending and rising" beats "watch
          your discretionary spending".
        - Do not moralise, and do not pad. Every sentence must carry a number or a claim
          that a number supports.
        - If the data is too thin to support a finding, say so rather than stretching it.

        Answer with one JSON object, exactly this shape and no other keys:
        {
          "headline": "one sentence, the single most important thing",
          "summary": "two or three sentences of overview",
          "findings": [ { "title": "short", "detail": "one or two sentences with figures", "severity": "high|medium|low" } ],
          "patterns": [ "a habit or rhythm the numbers show" ],
          "risks": [ "something that will cost them if it carries on" ],
          "actions": [ "one concrete thing to do, with the figure it would change" ]
        }
        Between three and six findings. Two to five patterns, risks and actions. An empty
        list is allowed where there is genuinely nothing to say.
        """;

    public async Task<AnalysisResponse> ReadAsync(
        string country,
        IReadOnlyList<string>? accountIds,
        int months,
        CancellationToken cancellationToken)
    {
        var wanted = (accountIds ?? [])
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var covered = Math.Clamp(months <= 0 ? DefaultMonths : months, 1, MaxMonths);

        var today = DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
        var first = new DateOnly(today.Year, today.Month, 1).AddMonths(-(covered - 1));

        var transactions = await db.Transactions.AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country && row.Date >= first && row.Date <= today)
            .Where(row => wanted.Count == 0 || (row.AccountId != null && wanted.Contains(row.AccountId)))
            .OrderBy(row => row.Date)
            .ToListAsync(cancellationToken);

        var accounts = await db.Accounts.AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country)
            .ToListAsync(cancellationToken);

        var items = await db.BudgetItems.AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country)
            .ToListAsync(cancellationToken);

        // This month's assignments, which is the budget the spending is measured against.
        var assignments = await db.BudgetAssignments.AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country && row.Year == today.Year && row.Month == today.Month)
            .ToListAsync(cancellationToken);

        var settings = await db.Settings.AsNoTracking()
            .FirstOrDefaultAsync(row => row.UserId == me.Id, cancellationToken);

        var facts = FactsOf(transactions, accounts, items, assignments, first, today, wanted, settings?.Currency ?? "EUR");

        var report = await AskAsync(facts, cancellationToken);

        return new AnalysisResponse(
            clock.GetUtcNow().UtcDateTime,
            ai.Model,
            new AnalysisPeriod(first, today, covered),
            facts.Accounts,
            facts,
            report);
    }

    /// <summary>
    /// The numbers, from rows and a date range. No database, no clock, no model: this is
    /// what a test can check and what the report is allowed to talk about.
    /// </summary>
    internal static AnalysisFacts FactsOf(
        IReadOnlyList<TransactionRow> transactions,
        IReadOnlyList<Account> accounts,
        IReadOnlyList<BudgetItem> items,
        IReadOnlyList<BudgetAssignment> assignments,
        DateOnly first,
        DateOnly last,
        IReadOnlyList<string> accountFilter,
        string currency)
    {
        var itemNames = items.ToDictionary(item => item.Id, item => item.Name);
        var accountNames = accounts.ToDictionary(account => account.Id, account => account.Name, StringComparer.OrdinalIgnoreCase);

        var spending = transactions.Where(row => row.Type == "out").ToList();
        var income = transactions.Where(row => row.Type == "in").ToList();

        var totalIn = income.Sum(row => row.Amount);
        var totalOut = spending.Sum(row => row.Amount);

        var months = MonthsBetween(first, last);

        var byMonth = months
            .Select(month => new AnalysisMonth(
                MonthKey(month),
                Sum(transactions, month, "in"),
                Sum(transactions, month, "out"),
                transactions.Count(row => InMonth(row.Date, month))))
            .ToList();

        var spentByMonth = byMonth.Select(month => month.Out).Where(amount => amount > 0).ToList();
        var averageOut = spentByMonth.Count == 0 ? 0m : Math.Round(spentByMonth.Average(), 2);

        var categories = spending
            .GroupBy(row => row.ItemId)
            .Select(group => new AnalysisCategory(
                group.Key,
                group.Key is { } id && itemNames.TryGetValue(id, out var name) ? name : "Uncategorised",
                Math.Round(group.Sum(row => row.Amount), 2),
                group.Count(),
                Share(group.Sum(row => row.Amount), totalOut),
                group.Key is { } item ? AssignedTo(assignments, item) : 0m,
                AssignmentsFor(assignments, group.Key)))
            .OrderByDescending(category => category.Spent)
            .ToList();

        // Grouped by the name on the transaction: a bank statement's payee is the closest
        // this data has to a merchant, and the cleaning the import does has already made
        // "TESCO STORES 1234" into something worth grouping.
        var merchants = spending
            .GroupBy(row => row.Name.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(group => new AnalysisMerchant(
                group.First().Name.Trim(),
                Math.Round(group.Sum(row => row.Amount), 2),
                group.Count(),
                Math.Round(group.Average(row => row.Amount), 2),
                group.Select(row => MonthKey(row.Date)).Distinct().Count(),
                group.Max(row => row.Date).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)))
            .OrderByDescending(merchant => merchant.Spent)
            .Take(12)
            .ToList();

        var byAccount = spending
            .GroupBy(row => row.AccountId)
            .Select(group => new AnalysisAccountSlice(
                group.Key,
                group.Key is not null && accountNames.TryGetValue(group.Key, out var name) ? name : "Unassigned",
                Math.Round(income.Where(row => row.AccountId == group.Key).Sum(row => row.Amount), 2),
                Math.Round(group.Sum(row => row.Amount), 2),
                group.Count(),
                Share(group.Sum(row => row.Amount), totalOut)))
            .OrderByDescending(slice => slice.Out)
            .ToList();

        var byWeekday = Enum.GetValues<DayOfWeek>()
            .Select(day => new AnalysisWeekday(
                day.ToString(),
                Math.Round(spending.Where(row => row.Date.DayOfWeek == day).Sum(row => row.Amount), 2),
                spending.Count(row => row.Date.DayOfWeek == day),
                Share(spending.Where(row => row.Date.DayOfWeek == day).Sum(row => row.Amount), totalOut)))
            .ToList();

        var largest = spending
            .OrderByDescending(row => row.Amount)
            .Take(10)
            .Select(row => new AnalysisEntry(
                row.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                row.Name,
                Math.Round(row.Amount, 2),
                row.AccountId is not null && accountNames.TryGetValue(row.AccountId, out var accountName) ? accountName : "Unassigned",
                row.ItemId is { } item && itemNames.TryGetValue(item, out var itemName) ? itemName : "Uncategorised"))
            .ToList();

        // A name that turns up in three months or more is a bill, not a one-off, and the
        // spread of its amounts is what says whether it is steady.
        var recurring = spending
            .GroupBy(row => row.Name.Trim(), StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Select(row => MonthKey(row.Date)).Distinct().Count() >= 3)
            .Select(group => new AnalysisRecurring(
                group.First().Name.Trim(),
                Math.Round(group.Average(row => row.Amount), 2),
                group.Select(row => MonthKey(row.Date)).Distinct().Count(),
                group.Count(),
                group.Max(row => row.Date).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)))
            .OrderByDescending(entry => entry.Amount)
            .Take(10)
            .ToList();

        var currentMonth = months[^1];
        var spentThisMonth = spending.Where(row => InMonth(row.Date, currentMonth)).ToList();
        var assignedTotal = assignments.Sum(row => row.Assigned);

        var overBudget = assignments
            .GroupBy(row => row.ItemId)
            .Select(group => new AnalysisOverspend(
                group.Key,
                itemNames.TryGetValue(group.Key, out var name) ? name : $"Item {group.Key}",
                Math.Round(group.Sum(row => row.Assigned), 2),
                Math.Round(spentThisMonth.Where(row => row.ItemId == group.Key).Sum(row => row.Amount), 2)))
            .Select(entry => entry with { Over = Math.Round(entry.Spent - entry.Assigned, 2) })
            .Where(entry => entry.Over > 0)
            .OrderByDescending(entry => entry.Over)
            .ToList();

        return new AnalysisFacts(
            currency,
            new AnalysisTotals(
                Math.Round(totalIn, 2),
                Math.Round(totalOut, 2),
                Math.Round(totalIn - totalOut, 2),
                Share(totalIn - totalOut, totalIn),
                Math.Round(averageOut, 2),
                transactions.Count,
                Math.Round(spending.Count == 0 ? 0 : spending.Average(row => row.Amount), 2),
                spending.Count(row => row.ItemId is null)),
            byMonth,
            categories.Take(15).ToList(),
            merchants,
            byAccount,
            byWeekday,
            largest,
            recurring,
            new AnalysisBudget(
                Math.Round(assignedTotal, 2),
                Math.Round(spentThisMonth.Sum(row => row.Amount), 2),
                overBudget.Count,
                overBudget.Take(10).ToList(),
                spending.Count(row => row.ItemId is null),
                Math.Round(spending.Where(row => row.ItemId is null).Sum(row => row.Amount), 2)),
            spending.Count(row => row.Flagged == true),
            Math.Round(spending.Where(row => row.Flagged == true).Sum(row => row.Amount), 2));
    }

    /// <summary>
    /// The model's JSON as a report, or the reason it could not be read. Separate from the
    /// call so a test can hand it any answer, including a bad one.
    /// </summary>
    internal static (AnalysisReport? Report, string? Problem) ReportFrom(string answer)
    {
        ModelReport? parsed;

        try
        {
            parsed = JsonSerializer.Deserialize<ModelReport>(answer, Reading);
        }
        catch (JsonException)
        {
            return (null, "The report could not be read.");
        }

        if (parsed is null || string.IsNullOrWhiteSpace(parsed.Headline) && string.IsNullOrWhiteSpace(parsed.Summary))
            return (null, "The report was empty.");

        return (new AnalysisReport(
            Clean(parsed.Headline) ?? "Analysis",
            Clean(parsed.Summary) ?? "",
            (parsed.Findings ?? []).Where(finding => Clean(finding?.Title) is not null)
                .Select(finding => new AnalysisFinding(
                    Clean(finding!.Title)!,
                    Clean(finding.Detail) ?? "",
                    Severity(finding.Severity)))
                .ToList(),
            Lines(parsed.Patterns),
            Lines(parsed.Risks),
            Lines(parsed.Actions)), null);
    }

    private async Task<AnalysisReport> AskAsync(AnalysisFacts facts, CancellationToken cancellationToken)
    {
        var question = new StringBuilder()
            .AppendLine("Here are the facts, for the period and accounts shown. Write the report.")
            .AppendLine(JsonSerializer.Serialize(facts, Writing))
            .ToString();

        var answer = await ai.AskForJsonAsync(SystemPrompt, question, DeepSeekClient.ReportTokens, cancellationToken);
        var (report, problem) = ReportFrom(answer);

        return report ?? throw new AiUnavailableException(problem ?? "The report could not be read.");
    }

    // ── helpers ────────────────────────────────────────────────────────────────────────

    private static readonly JsonSerializerOptions Writing = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly JsonSerializerOptions Reading = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private static List<DateOnly> MonthsBetween(DateOnly first, DateOnly last)
    {
        var months = new List<DateOnly>();

        for (var month = new DateOnly(first.Year, first.Month, 1); month <= last; month = month.AddMonths(1))
            months.Add(month);

        return months.Count == 0 ? [new DateOnly(last.Year, last.Month, 1)] : months;
    }

    private static bool InMonth(DateOnly date, DateOnly month) =>
        date.Year == month.Year && date.Month == month.Month;

    private static decimal Sum(IReadOnlyList<TransactionRow> rows, DateOnly month, string type) =>
        Math.Round(rows.Where(row => row.Type == type && InMonth(row.Date, month)).Sum(row => row.Amount), 2);

    private static decimal AssignedTo(IReadOnlyList<BudgetAssignment> assignments, int itemId) =>
        Math.Round(assignments.Where(row => row.ItemId == itemId).Sum(row => row.Assigned), 2);

    private static string? AssignmentsFor(IReadOnlyList<BudgetAssignment> assignments, int? itemId) =>
        itemId is { } id
            ? assignments.FirstOrDefault(row => row.ItemId == id)?.Category
            : null;

    /// <summary>A share of a total, as a percentage with one decimal, or 0 when there is no total.</summary>
    private static decimal Share(decimal part, decimal whole) =>
        whole == 0 ? 0 : Math.Round(part / whole * 100, 1);

    private static string MonthKey(DateOnly date) =>
        date.ToString("yyyy-MM", CultureInfo.InvariantCulture);

    private static string? Clean(string? text)
    {
        var trimmed = text?.Trim();

        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static List<string> Lines(List<string?>? lines) =>
        (lines ?? []).Select(Clean).OfType<string>().ToList();

    private static string Severity(string? severity) =>
        severity?.Trim().ToLowerInvariant() switch
        {
            "high" => "high",
            "low" => "low",
            _ => "medium",
        };

    /// <summary>What DeepSeek answers with. Nullable throughout: a model is not a compiler.</summary>
    private sealed record ModelReport(
        string? Headline,
        string? Summary,
        List<ModelFinding?>? Findings,
        List<string?>? Patterns,
        List<string?>? Risks,
        List<string?>? Actions);

    private sealed record ModelFinding(string? Title, string? Detail, string? Severity);
}

// ── The wire shapes ────────────────────────────────────────────────────────────────────

/// <summary>Whether the box can write a report, and which model would write it.</summary>
public sealed record AiStatusResponse(bool Available, string Model);

public sealed record AnalysisRequest(List<string>? Accounts, int? Months);

public sealed record AnalysisPeriod(DateOnly From, DateOnly To, int Months);

public sealed record AnalysisResponse(
    DateTime GeneratedAt,
    string Model,
    AnalysisPeriod Period,
    List<AnalysisAccountSlice> Accounts,
    AnalysisFacts Facts,
    AnalysisReport Report);

public sealed record AnalysisFacts(
    string Currency,
    AnalysisTotals Totals,
    List<AnalysisMonth> Months,
    List<AnalysisCategory> Categories,
    List<AnalysisMerchant> Merchants,
    List<AnalysisAccountSlice> Accounts,
    List<AnalysisWeekday> Weekdays,
    List<AnalysisEntry> Largest,
    List<AnalysisRecurring> Recurring,
    AnalysisBudget Budget,
    int FlaggedCount,
    decimal FlaggedAmount);

public sealed record AnalysisTotals(
    decimal In,
    decimal Out,
    decimal Net,
    decimal SavingsRate,
    decimal AverageOutPerMonth,
    int Transactions,
    decimal AverageTransaction,
    int Uncategorised);

public sealed record AnalysisMonth(string Month, decimal In, decimal Out, int Count);

public sealed record AnalysisCategory(
    int? ItemId,
    string Name,
    decimal Spent,
    int Count,
    decimal Share,
    decimal Assigned,
    string? Category);

public sealed record AnalysisMerchant(string Name, decimal Spent, int Count, decimal Average, int Months, string Last);

public sealed record AnalysisAccountSlice(string? Id, string Name, decimal In, decimal Out, int Count, decimal Share);

public sealed record AnalysisWeekday(string Day, decimal Spent, int Count, decimal Share);

public sealed record AnalysisEntry(string Date, string Name, decimal Amount, string Account, string Item);

public sealed record AnalysisRecurring(string Name, decimal Amount, int Months, int Count, string Last);

public sealed record AnalysisBudget(
    decimal Assigned,
    decimal Spent,
    int OverBudgetItems,
    List<AnalysisOverspend> Overspending,
    int UncategorisedTransactions,
    decimal UncategorisedAmount);

public sealed record AnalysisOverspend(int ItemId, string Name, decimal Assigned, decimal Spent, decimal Over = 0);

public sealed record AnalysisReport(
    string Headline,
    string Summary,
    List<AnalysisFinding> Findings,
    List<string> Patterns,
    List<string> Risks,
    List<string> Actions);

public sealed record AnalysisFinding(string Title, string Detail, string Severity);
