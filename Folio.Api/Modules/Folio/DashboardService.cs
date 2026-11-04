using Microsoft.EntityFrameworkCore;
using Folio.Api.Auth;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

/// <summary>
/// What the Dashboard shows, worked out here rather than in the browser.
///
/// The page used to add up four collections in four computeds, and every one of them was
/// a rule: which accounts the budget ignores, which month a transaction belongs to, what
/// a spending line is. Those rules are now in <see cref="Compute"/>, which takes rows and
/// dates and nothing else, so they can be checked without a database or a clock.
/// </summary>
public sealed class DashboardService(FolioDbContext db, CurrentUser me, TimeProvider clock)
{
    /// <summary>How many spending lines, budget lines and transactions the page has room for.</summary>
    public const int TopSpendingCount = 5;
    public const int TopBudgetRows = 5;
    public const int RecentCount = 8;

    public async Task<DashboardReport> ReadAsync(
        string country,
        DateOnly? month,
        DateOnly? budgetMonth,
        CancellationToken cancellationToken)
    {
        var settings = await db.Settings.AsNoTracking().FirstOrDefaultAsync(row => row.UserId == me.Id, cancellationToken);
        var startDay = settings is null ? 1 : (int)settings.BillableMonthStart;

        var transactions = await db.Transactions
            .AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country)
            .ToListAsync(cancellationToken);

        var accounts = await db.Accounts
            .AsNoTracking()
            .Where(row => row.UserId == me.Id && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ThenBy(row => row.Id)
            .ToListAsync(cancellationToken);

        var today = DateOnly.FromDateTime(clock.GetLocalNow().DateTime);
        var shown = month ?? FirstOf(today.Year, today.Month);
        var budgeted = budgetMonth ?? FirstOf(today.Year, today.Month);

        var lines = await Assignments.ReadAsync(db, me.Id, country, budgeted, cancellationToken);
        var names = await Assignments.NamesAsync(db, me.Id, country, cancellationToken);

        return Compute(transactions, accounts, lines, names, startDay, shown, budgeted);
    }

    /// <summary>The dashboard's numbers, from rows and two months. No database, no clock.</summary>
    public static DashboardReport Compute(
        IReadOnlyList<TransactionRow> transactions,
        IReadOnlyList<Account> accounts,
        IReadOnlyList<BudgetLine> budgetLines,
        IReadOnlyDictionary<int, string> budgetNames,
        int billableMonthStart,
        DateOnly month,
        DateOnly budgetMonth)
    {
        var startDay = billableMonthStart <= 0 ? 1 : billableMonthStart;
        var ignored = IgnoredAccountIds(accounts);

        var spent = transactions
            .Where(row => InCalendarMonth(row, month) && !Ignored(row, ignored))
            .ToList();

        var income = spent.Where(row => row.Type == "in").Sum(row => row.Amount);
        var expenses = spent.Where(row => row.Type == "out").Sum(row => row.Amount);
        var net = income - expenses;

        var totals = new MonthTotals(
            RoundCents(income),
            RoundCents(expenses),
            RoundCents(net),
            JsRound(income > 0 ? (income - expenses) / income * 100 : 0),
            spent.Count(row => row.Type == "in"),
            spent.Count(row => row.Type == "out"));

        return new DashboardReport(
            totals,
            Balances(transactions, accounts),
            TopSpending(spent),
            Budget(budgetLines, budgetNames, transactions, startDay, budgetMonth),
            Recent(transactions));
    }

    /// <summary>
    /// An account the budget leaves out: archived ones always, a liability unless it says
    /// otherwise, and anything whose own flag says so.
    /// </summary>
    private static HashSet<string> IgnoredAccountIds(IReadOnlyList<Account> accounts) =>
        accounts
            .Where(account => account.Archived == true
                || (account.ExcludeFromBudget ?? account.Type == "liability"))
            .Select(account => account.Id)
            .ToHashSet(StringComparer.Ordinal);

    private static bool Ignored(TransactionRow row, HashSet<string> ignored) =>
        row.AccountId is { } id && ignored.Contains(id);

    private static bool InCalendarMonth(TransactionRow row, DateOnly month) =>
        row.Date.Year == month.Year && row.Date.Month == month.Month;

    /// <summary>Every account's balance, and a line for money that belongs to none of them.</summary>
    private static List<AccountBalance> Balances(
        IReadOnlyList<TransactionRow> transactions,
        IReadOnlyList<Account> accounts)
    {
        var balances = new Dictionary<string, decimal>(StringComparer.Ordinal);
        var unassigned = 0m;
        var anyUnassigned = false;

        foreach (var row in transactions)
        {
            var delta = row.Type == "in" ? row.Amount : -row.Amount;

            if (row.AccountId is { Length: > 0 } id)
                balances[id] = balances.GetValueOrDefault(id) + delta;
            else
            {
                unassigned += delta;
                anyUnassigned = true;
            }
        }

        var rows = accounts
            .Select(account => new AccountBalance(account.Id, account.Name, RoundCents(balances.GetValueOrDefault(account.Id))))
            .ToList();

        if (anyUnassigned)
            rows.Add(new AccountBalance("__unassigned__", "Unassigned", RoundCents(unassigned)));

        return rows;
    }

    /// <summary>The month's biggest outgoings, by the name they were given.</summary>
    private static List<SpendingLine> TopSpending(IReadOnlyList<TransactionRow> month) =>
        month
            .Where(row => row.Type == "out")
            .GroupBy(row => row.Name, StringComparer.Ordinal)
            .Select(group => new SpendingLine(group.Key, RoundCents(group.Sum(row => row.Amount))))
            .OrderByDescending(line => line.Total)
            .Take(TopSpendingCount)
            .ToList();

    /// <summary>
    /// The budget as the month stands: what was assigned, what has been spent against it,
    /// and the lines closest to their limit. Null when no budget has been set at all.
    /// </summary>
    private static BudgetStatus? Budget(
        IReadOnlyList<BudgetLine> budgetLines,
        IReadOnlyDictionary<int, string> names,
        IReadOnlyList<TransactionRow> transactions,
        int startDay,
        DateOnly budgetMonth)
    {
        if (budgetLines.Count == 0)
            return null;

        var activity = Activity(transactions, startDay, budgetMonth);

        var rows = budgetLines
            .Select(line =>
            {
                var spent = activity.GetValueOrDefault(line.ItemId);
                var available = RoundCents(line.Assigned - spent);

                return new BudgetRow(
                    line.ItemId,
                    names.GetValueOrDefault(line.ItemId, ""),
                    RoundCents(line.Assigned),
                    RoundCents(spent),
                    available,
                    line.Assigned > 0 ? Math.Min(100, JsRound(spent / line.Assigned * 100)) : spent > 0 ? 100 : 0);
            })
            .ToList();

        var assigned = RoundCents(rows.Sum(row => row.Assigned));
        var spentTotal = RoundCents(rows.Sum(row => row.Activity));

        return new BudgetStatus(
            assigned,
            spentTotal,
            rows.Count(row => row.Available < 0),
            rows.Count(row => row.Available >= 0),
            assigned > 0 ? Math.Min(100, JsRound(spentTotal / assigned * 100)) : 0,
            rows.OrderByDescending(row => row.Pct).ThenBy(row => row.Id).Take(TopBudgetRows).ToList());
    }

    /// <summary>
    /// What each budget line was spent on in a billable month: money out adds, money in
    /// takes away, which is how a refund lands back in its envelope.
    /// </summary>
    private static Dictionary<int, decimal> Activity(
        IReadOnlyList<TransactionRow> transactions,
        int startDay,
        DateOnly month)
    {
        var activity = new Dictionary<int, decimal>();

        foreach (var row in transactions)
        {
            if (row.ItemId is not { } itemId || !InBillableMonth(row, startDay, month))
                continue;

            activity[itemId] = activity.GetValueOrDefault(itemId) + (row.Type == "out" ? row.Amount : -row.Amount);
        }

        return activity;
    }

    /// <summary>Whether a date falls in a billable month: the day the budget starts decides.</summary>
    private static bool InBillableMonth(TransactionRow row, int startDay, DateOnly month)
    {
        if (startDay <= 1 || row.Date.Day >= startDay)
            return row.Date.Year == month.Year && row.Date.Month == month.Month;

        var owning = new DateOnly(row.Date.Year, row.Date.Month, 1).AddMonths(-1);

        return owning.Year == month.Year && owning.Month == month.Month;
    }

    /// <summary>The newest transactions, for the list under the accounts.</summary>
    private static List<TransactionLine> Recent(IReadOnlyList<TransactionRow> transactions) =>
        transactions
            .OrderByDescending(row => row.Date)
            .ThenByDescending(row => row.CreatedAt)
            .Take(RecentCount)
            .Select(row => new TransactionLine(row.Id, row.Name, row.Date, row.AccountId, row.Amount, row.Type))
            .ToList();

    private static DateOnly FirstOf(int year, int month) => new(year, month, 1);

    private static decimal RoundCents(decimal value) => JsRound1(value);

    // JavaScript's Math.round: a half always goes up, where C# would round it to even.
    private static int JsRound(decimal value) => (int)Math.Floor(value + 0.5m);

    private static decimal JsRound1(decimal value) => Math.Floor(value * 100 + 0.5m) / 100;
}

/// <summary>What the Dashboard is given: one answer, so its cards cannot disagree.</summary>
public sealed record DashboardReport(
    MonthTotals Totals,
    IReadOnlyList<AccountBalance> Accounts,
    IReadOnlyList<SpendingLine> TopSpending,
    BudgetStatus? Budget,
    IReadOnlyList<TransactionLine> Recent);

public sealed record MonthTotals(
    decimal Income,
    decimal Expenses,
    decimal Net,
    int SavingsRate,
    int IncomeCount,
    int ExpenseCount);

public sealed record AccountBalance(string Id, string Name, decimal Balance);

public sealed record SpendingLine(string Name, decimal Total);

public sealed record BudgetStatus(
    decimal TotalAssigned,
    decimal TotalActivity,
    int OverCount,
    int OnTrack,
    int OverallPct,
    IReadOnlyList<BudgetRow> TopRows);

public sealed record BudgetRow(int Id, string Name, decimal Assigned, decimal Activity, decimal Available, int Pct);

public sealed record TransactionLine(int Id, string Name, DateOnly Date, string? AccountId, decimal Amount, string Type);
