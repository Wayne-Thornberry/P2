using Microsoft.EntityFrameworkCore;
using Folio.Api.Auth;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

/// <summary>
/// The financial health score, worked out here rather than in the browser.
///
/// It reads what is saved and answers with the score, the grade and the parts it is made
/// of, so the Dashboard and the Performance page show the same numbers and neither has to
/// know what a good savings rate is. The arithmetic is a pure function
/// (<see cref="Compute"/>) over rows and a date: a test can hand it a fixed day and check
/// the score without a database or a clock.
/// </summary>
public sealed class HealthService(FolioDbContext db, CurrentUser me, TimeProvider clock)
{
    /// <summary>Completed months the score looks at. The current one is still being lived.</summary>
    public const int WindowMonths = 6;

    public async Task<HealthReport> ReadAsync(string country, DateOnly? viewed, CancellationToken cancellationToken)
    {
        var settings = await db.Settings.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == me.Id, cancellationToken);
        var startDay = settings is null ? 1 : settings.BillableMonthStart;

        var transactions = await db.Transactions
            .AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country)
            .ToListAsync(cancellationToken);

        var today = DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
        var month = viewed ?? FirstOf(BillableMonth(today, startDay));
        var lines = await Assignments.ReadAsync(db, me.Id, country, month, cancellationToken);

        return Compute(transactions, lines, startDay, today, month);
    }

    /// <summary>The score and its parts, from rows and a day. No database, no clock.</summary>
    public static HealthReport Compute(
        IReadOnlyList<TransactionRow> transactions,
        IReadOnlyList<BudgetLine> budgetLines,
        int billableMonthStart,
        DateOnly today,
        DateOnly? viewed)
    {
        var startDay = billableMonthStart <= 0 ? 1 : billableMonthStart;
        var current = BillableMonth(today, startDay);
        var viewedMonth = viewed is { } given ? (given.Year, given.Month) : current;

        // The window is the completed months only, oldest first: -WindowMonths to -1, so
        // "the last three" is the end of the list.
        var months = Enumerable.Range(-WindowMonths, WindowMonths)
            .Select(offset => Offset(current, offset))
            .ToList();

        var totals = months
            .Select(month => new MonthTotal(
                Sum(transactions, month, startDay, "in"),
                Sum(transactions, month, startDay, "out")))
            .ToList();

        var recent = totals.Skip(WindowMonths - 3).Where(month => month.Income > 0 || month.Expenses > 0).ToList();

        var rolling = recent.Count == 0
            ? new RollingAverage(0, 0, 0)
            : new RollingAverage(
                recent.Average(month => month.Income),
                recent.Average(month => month.Expenses),
                Rate(recent.Average(month => month.Income), recent.Average(month => month.Expenses)));

        var net = transactions.Sum(row => row.Type == "in" ? row.Amount : -row.Amount);
        var reserve = rolling.Expenses <= 0 ? (decimal?)null : JsRound1(net / rolling.Expenses);

        var adherence = Adherence(transactions, budgetLines, startDay, Offset(current, -1));
        var consistency = totals.Skip(WindowMonths - 3).Count(month => month.Income > 0);

        var score = Score(rolling.SavingsRate, reserve, adherence, consistency);

        return new HealthReport(score, GradeOf(score), rolling, reserve, adherence, consistency);
    }

    /// <summary>
    /// Out of 100: savings rate 35, emergency reserve 30, budget adherence 20, income
    /// consistency 15. With no budget the adherence points cannot be earned, so the rest
    /// is scaled up rather than leaving a perfect budget-less month short of 100.
    /// </summary>
    private static int Score(int savingsRate, decimal? reserveMonths, BudgetAdherence? adherence, int incomeConsistency)
    {
        var score = 0;

        score += savingsRate switch
        {
            >= 20 => 35,
            >= 10 => 25,
            >= 5 => 15,
            >= 0 => 8,
            _ => 0,
        };

        var reserve = reserveMonths ?? 0;
        score += reserve switch
        {
            >= 6 => 30,
            >= 3 => 22,
            >= 1 => 12,
            > 0 => 4,
            _ => 0,
        };

        if (adherence is { } budget)
        {
            score += budget.Pct switch
            {
                100 => 20,
                >= 75 => 15,
                >= 50 => 8,
                _ => 2,
            };
        }

        score += incomeConsistency switch
        {
            3 => 15,
            2 => 9,
            1 => 4,
            _ => 0,
        };

        var finished = adherence is null ? JsRound(score / 80m * 100) : score;

        return Math.Clamp(finished, 0, 100);
    }

    public static HealthGrade GradeOf(int score) => score switch
    {
        >= 85 => new HealthGrade("A", "Excellent", "#10b981"),
        >= 70 => new HealthGrade("B", "Good", "#22d3ee"),
        >= 55 => new HealthGrade("C", "Fair", "#f59e0b"),
        >= 40 => new HealthGrade("D", "Needs Work", "#f97316"),
        _ => new HealthGrade("F", "Critical", "#ef4444"),
    };

    /// <summary>How many budget lines were not overspent in one billable month.</summary>
    private static BudgetAdherence? Adherence(
        IReadOnlyList<TransactionRow> transactions,
        IReadOnlyList<BudgetLine> budgetLines,
        int startDay,
        (int Year, int Month) month)
    {
        if (budgetLines.Count == 0)
            return null;

        var spent = new Dictionary<int, decimal>();

        foreach (var row in transactions)
        {
            if (row.ItemId is not { } itemId || BillableMonth(row.Date, startDay) != month)
                continue;

            spent[itemId] = spent.GetValueOrDefault(itemId) + (row.Type == "out" ? row.Amount : -row.Amount);
        }

        var over = budgetLines.Count(line => spent.GetValueOrDefault(line.ItemId) > line.Assigned);
        var total = budgetLines.Count;

        return new BudgetAdherence(total, over, total - over, JsRound((total - over) * 100m / total));
    }

    private static decimal Sum(
        IReadOnlyList<TransactionRow> transactions,
        (int Year, int Month) month,
        int startDay,
        string type) =>
        transactions
            .Where(row => row.Type == type && BillableMonth(row.Date, startDay) == month)
            .Sum(row => row.Amount);

    /// <summary>(income - expenses) / income, as the whole percentage the score is banded on.</summary>
    private static int Rate(decimal income, decimal expenses) =>
        income > 0 ? JsRound((income - expenses) / income * 100) : 0;

    /// <summary>The billable month a date belongs to: the day of the month the budget starts decides.</summary>
    private static (int Year, int Month) BillableMonth(DateOnly date, int startDay)
    {
        if (startDay <= 1 || date.Day >= startDay)
            return (date.Year, date.Month);

        return date.Month == 1 ? (date.Year - 1, 12) : (date.Year, date.Month - 1);
    }

    private static (int Year, int Month) Offset((int Year, int Month) month, int by)
    {
        var shifted = new DateOnly(month.Year, month.Month, 1).AddMonths(by);

        return (shifted.Year, shifted.Month);
    }

    private static DateOnly FirstOf((int Year, int Month) month) => new(month.Year, month.Month, 1);

    // JavaScript's Math.round: a half always goes up. C#'s default banker's rounding would
    // answer differently on the .5 that a percentage falls on often enough to notice.
    private static int JsRound(decimal value) => (int)Math.Floor(value + 0.5m);

    private static decimal JsRound1(decimal value) => Math.Floor(value * 10 + 0.5m) / 10;
}

/// <summary>One month of the window, already summed.</summary>
public sealed record MonthTotal(decimal Income, decimal Expenses);

/// <summary>What the site is given: the score, the grade, and the parts it is made of.</summary>
public sealed record HealthReport(
    int Score,
    HealthGrade Grade,
    RollingAverage Rolling3,
    decimal? ReserveMonths,
    BudgetAdherence? BudgetAdherence,
    int IncomeConsistency);

public sealed record HealthGrade(string Letter, string Label, string Color);

public sealed record RollingAverage(decimal Income, decimal Expenses, int SavingsRate);

public sealed record BudgetAdherence(int Total, int Over, int OnTrack, int Pct);
