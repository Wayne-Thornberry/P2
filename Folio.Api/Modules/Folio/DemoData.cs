using System.Globalization;

namespace Folio.Api.Modules.Folio;

// ── Demo data ──────────────────────────────────────────────────────────────────────────
// A year of plausible budgeting for one of three people, so a box with an empty database
// has something to look at.
//
// The rules are here rather than in the browser because they are rules: what a "saver"
// spends on groceries, how often a fixed bill is paid, how much of the budget is actually
// spent. The site used to hold them, which meant the shape of a stranger's finances was
// part of the download and the mock had its own opinion of the answer. Now the site asks
// for a workspace and stores what it is given.

/// <summary>What to make: for whom, over which months, and on what income.</summary>
public sealed record DemoRequest(
    string? Persona,
    int StartYear,
    int StartMonth,
    int EndYear,
    int EndMonth,
    decimal MonthlyIncome,
    bool IncludeSavingsGoals,
    bool IncludeFinance);

/// <summary>What was made, in the words the site shows afterwards.</summary>
public sealed record DemoResult(
    int AccountsCreated,
    int BudgetMonths,
    int TransactionsAdded,
    int GoalsCreated,
    int LoansCreated,
    int FinanceSavingsCreated);

/// <summary>A collection ready to be saved, and the count that describes it.</summary>
public sealed record DemoWorkspace(
    AccountsBlob Accounts,
    TransactionsBlob Transactions,
    BudgetBlob Budget,
    TemplateBlob Template,
    SavingsGoalsBlob SavingsGoals,
    FinanceBlob Finance,
    DemoResult Result);

public static class DemoData
{
    /// <summary>The longest period one request may cover, so a typo cannot insert thousands of rows.</summary>
    public const int MaxMonths = 120;

    /// <summary>The id the site's account counter starts at, matched so demo ids look like its own.</summary>
    private const int FirstAccountId = 10;

    private const int FirstTransactionId = 500;

    private const int FirstItemId = 2000;

    private static readonly string[] GoalColors =
        ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#ec4899"];

    private static readonly string[] LoanColors =
        ["#ef4444", "#f97316", "#6366f1", "#8b5cf6", "#ec4899", "#14b8a6", "#10b981", "#f59e0b"];

    private static readonly string[] SavingsColors =
        ["#10b981", "#14b8a6", "#6366f1", "#8b5cf6", "#f59e0b", "#f97316", "#ec4899", "#ef4444"];

    /// <summary>A budget item every persona has, with what each of them spends on it.</summary>
    private sealed record Item(string Name, string Category, decimal Saver, decimal Balanced, decimal Indebted)
    {
        public decimal For(Persona persona) => persona switch
        {
            Persona.Saver => Saver,
            Persona.Indebted => Indebted,
            _ => Balanced,
        };
    }

    private sealed record Goal(string Name, decimal Target, decimal OpeningBalance, decimal MonthlyContribution);

    private sealed record Loan(string Name, decimal Principal, decimal Apr, int TermMonths, int MonthsAgo);

    private sealed record SavingsRecord(string Name, decimal Apr, decimal BalanceMultiplier, int MonthsAgo);

    private enum Persona
    {
        Saver,
        Balanced,
        Indebted,
    }

    private static readonly Item[] Items =
    [
        new("Rent / Mortgage", "Housing", 950, 1150, 1400),
        new("Utilities", "Housing", 80, 110, 150),
        new("Internet & Phone", "Housing", 85, 95, 120),
        new("Groceries", "Food", 350, 400, 500),
        new("Dining Out", "Food", 70, 150, 280),
        new("Fuel", "Transport", 90, 110, 150),
        new("Car Insurance", "Transport", 95, 110, 130),
        new("Gym Membership", "Health", 40, 40, 50),
        new("Healthcare", "Health", 30, 45, 80),
        new("Streaming", "Entertainment", 20, 30, 55),
        new("Going Out", "Entertainment", 50, 90, 180),
        new("Clothing", "Personal", 60, 100, 200),
        new("Personal Care", "Personal", 35, 50, 80),
    ];

    /// <summary>The bills that are paid once, in full, from the current account.</summary>
    private static readonly HashSet<string> FixedItems =
    [
        "Rent / Mortgage", "Utilities", "Internet & Phone", "Car Insurance", "Gym Membership", "Streaming",
    ];

    private static decimal SpendFactor(Persona persona) => persona switch
    {
        Persona.Saver => 0.74m,
        Persona.Indebted => 1.28m,
        _ => 0.97m,
    };

    private static readonly (string Name, string Type)[] SaverAccounts =
    [
        ("Main Checking", "asset"),
        ("High-Yield Savings", "asset"),
        ("Investment Account", "asset"),
        ("Credit Card", "liability"),
    ];

    private static readonly (string Name, string Type)[] BalancedAccounts =
    [
        ("Checking Account", "asset"),
        ("Savings Account", "asset"),
        ("Credit Card", "liability"),
    ];

    private static readonly (string Name, string Type)[] IndebtedAccounts =
    [
        ("Current Account", "asset"),
        ("Credit Card Visa", "liability"),
        ("Credit Card Mastercard", "liability"),
        ("Overdraft Account", "liability"),
    ];

    private static readonly Goal[] SaverGoals =
    [
        new("Emergency Fund", 15000, 12000, 200),
        new("House Deposit", 50000, 12500, 500),
        new("Holiday Fund", 3000, 2250, 100),
    ];

    private static readonly Goal[] BalancedGoals =
    [
        new("Emergency Fund", 10000, 4500, 100),
        new("Holiday Fund", 2000, 600, 80),
    ];

    private static readonly Goal[] IndebtedGoals =
    [
        new("Emergency Fund", 5000, 400, 30),
    ];

    private static readonly Loan[] SaverLoans =
    [
        new("Car Loan", 15000, 5.9m, 60, 36),
    ];

    private static readonly Loan[] BalancedLoans =
    [
        new("Car Loan", 18000, 7.2m, 48, 24),
    ];

    private static readonly Loan[] IndebtedLoans =
    [
        new("Personal Loan", 12000, 18.5m, 60, 12),
        new("Credit Card Debt", 4500, 24.9m, 24, 6),
        new("Car Finance", 20000, 9.9m, 72, 48),
    ];

    private static readonly SavingsRecord[] SaverSavings =
    [
        new("High-Yield Savings", 4.5m, 18, 24),
    ];

    private static readonly SavingsRecord[] BalancedSavings =
    [
        new("Regular Savings", 2.5m, 6, 12),
    ];

    /// <summary>Why this request cannot be answered, or null when it can.</summary>
    public static string? Refusal(DemoRequest request)
    {
        if (!TryPersona(request.Persona, out _))
            return "A persona is one of: saver, balanced, indebted.";

        if (request.MonthlyIncome is < 100 or > 999999)
            return "A monthly income is between 100 and 999999.";

        if (request.StartYear is < 2000 or > 2100 || request.EndYear is < 2000 or > 2100)
            return "A year is four digits, between 2000 and 2100.";

        if (request.StartMonth is < 1 or > 12 || request.EndMonth is < 1 or > 12)
            return "A month is 1 to 12.";

        if (Months(request) is < 1 or > MaxMonths)
            return $"The period is one to {MaxMonths} months, starting before it ends.";

        return null;
    }

    /// <summary>
    /// Everything a demo budget is made of, ready for the collections to be saved.
    ///
    /// The randomness is passed in rather than taken from the clock, so a test can ask for
    /// the same budget twice and get the same answer.
    /// </summary>
    public static DemoWorkspace Generate(DemoRequest request, Random random)
    {
        if (!TryPersona(request.Persona, out var persona))
            persona = Persona.Balanced;

        var accounts = AccountsFor(persona);
        var items = Items;
        var today = DateTime.UtcNow;
        var months = MonthsOf(request).ToList();

        // ── Accounts ───────────────────────────────────────────────────────────────────
        var accountRows = accounts
            .Select((account, index) => new AccountDto(
                $"acc-{FirstAccountId + index}",
                account.Name,
                account.Type,
                null,
                null,
                null))
            .ToList();

        var checkingId = accountRows[0].Id;
        var creditId = accounts.Length > 1 && accounts.Any(account => account.Type == "liability")
            ? accountRows[Array.FindIndex(accounts, account => account.Type == "liability")].Id
            : null;

        // ── Budget items, the template, and a month of assignments each ───────────────
        var itemIds = items
            .Select((item, index) => (item.Name, Id: FirstItemId + index))
            .ToDictionary(pair => pair.Name, pair => pair.Id);

        var globalItems = itemIds
            .Select(pair => new BudgetItemDto(pair.Value, pair.Key))
            .ToList();

        var template = new TemplateBlob(items
            .Select(item => new BudgetEntryDto(itemIds[item.Name], item.For(persona), item.Category))
            .ToList());

        var monthlyEntries = new Dictionary<string, Dictionary<string, List<BudgetEntryDto>>>();

        foreach (var (year, month) in months)
        {
            var yearText = year.ToString(CultureInfo.InvariantCulture);
            var monthText = month.ToString(CultureInfo.InvariantCulture);

            if (!monthlyEntries.TryGetValue(yearText, out var byMonth))
                monthlyEntries[yearText] = byMonth = [];

            byMonth[monthText] = items
                .Select(item => new BudgetEntryDto(itemIds[item.Name], item.For(persona), item.Category))
                .ToList();
        }

        // ── Transactions ──────────────────────────────────────────────────────────────
        var transactions = new List<TransactionDto>();
        var nextTransactionId = FirstTransactionId;
        var factor = SpendFactor(persona);

        foreach (var (year, month) in months)
        {
            var daysInMonth = DateTime.DaysInMonth(year, month);
            var paycheck = Cents(request.MonthlyIncome / 2);

            foreach (var payDay in new[] { 1, 15 })
            {
                transactions.Add(new TransactionDto(
                    nextTransactionId++,
                    "Salary",
                    new DateOnly(year, month, Math.Min(payDay, daysInMonth)),
                    today,
                    paycheck,
                    "in",
                    null,
                    checkingId,
                    null,
                    null,
                    null,
                    null));
            }

            foreach (var item in items)
            {
                var budgeted = item.For(persona);
                var fixedBill = FixedItems.Contains(item.Name);

                // A fixed bill is one payment; spending is spread over one to three, and a
                // bigger line is more likely to be two than three.
                var count = fixedBill
                    ? 1
                    : random.Next(1, budgeted > 150 ? 2 : 3) + 1;

                var accountId = fixedBill ? checkingId : creditId ?? checkingId;

                for (var paid = 0; paid < count; paid++)
                {
                    var day = random.Next(1, daysInMonth + 1);
                    var amount = WithNoise(budgeted * factor / count, 0.12m, random);

                    transactions.Add(new TransactionDto(
                        nextTransactionId++,
                        item.Name,
                        new DateOnly(year, month, day),
                        today,
                        amount,
                        "out",
                        itemIds[item.Name],
                        accountId,
                        null,
                        null,
                        null,
                        null));
                }
            }
        }

        // ── Savings goals ─────────────────────────────────────────────────────────────
        var goals = new List<SavingsGoalDto>();
        var nextGoalId = 1;
        var nextContributionId = 1;

        if (request.IncludeSavingsGoals)
        {
            var (openingYear, openingMonth) = MonthsBefore(request.StartYear, request.StartMonth, 1);

            foreach (var definition in GoalsFor(persona))
            {
                var id = nextGoalId++;
                var contributions = new List<ContributionDto>();

                if (definition.OpeningBalance > 0)
                {
                    contributions.Add(new ContributionDto(
                        nextContributionId++,
                        new DateOnly(openingYear, openingMonth, 28),
                        definition.OpeningBalance,
                        "Opening balance"));
                }

                if (definition.MonthlyContribution > 0)
                {
                    foreach (var (year, month) in months)
                    {
                        contributions.Add(new ContributionDto(
                            nextContributionId++,
                            new DateOnly(year, month, 5),
                            WithNoise(definition.MonthlyContribution, 0.05m, random),
                            null));
                    }
                }

                // The site keeps contributions newest-first.
                contributions.Sort((left, right) => right.Date.CompareTo(left.Date));

                goals.Add(new SavingsGoalDto(
                    id,
                    definition.Name,
                    definition.Target,
                    null,
                    GoalColors[id % GoalColors.Length],
                    null,
                    contributions,
                    today,
                    false));
            }
        }

        // ── Loans and savings accounts ────────────────────────────────────────────────
        var loans = new List<LoanDto>();
        var savings = new List<SavingsRecordDto>();
        var nextLoanId = 1;
        var nextSavingsId = 1;

        if (request.IncludeFinance)
        {
            foreach (var definition in LoansFor(persona))
            {
                var (year, month) = MonthsBefore(request.StartYear, request.StartMonth, definition.MonthsAgo);
                var id = nextLoanId++;

                loans.Add(new LoanDto(
                    id,
                    definition.Name,
                    definition.Principal,
                    definition.Apr,
                    definition.TermMonths,
                    new DateOnly(year, month, 1),
                    null,
                    LoanColors[id % LoanColors.Length],
                    today,
                    false));
            }

            foreach (var definition in SavingsFor(persona))
            {
                var (year, month) = MonthsBefore(request.StartYear, request.StartMonth, definition.MonthsAgo);
                var id = nextSavingsId++;

                savings.Add(new SavingsRecordDto(
                    id,
                    definition.Name,
                    definition.Apr,
                    "monthly",
                    Cents(definition.BalanceMultiplier * request.MonthlyIncome),
                    new DateOnly(year, month, 1),
                    null,
                    SavingsColors[id % SavingsColors.Length],
                    today,
                    false));
            }
        }

        return new DemoWorkspace(
            new AccountsBlob(accountRows, FirstAccountId + accountRows.Count),
            new TransactionsBlob(transactions, nextTransactionId),
            new BudgetBlob(globalItems, monthlyEntries, FirstItemId + items.Length),
            template,
            new SavingsGoalsBlob(goals, nextGoalId, nextContributionId),
            new FinanceBlob(loans, savings, nextLoanId, nextSavingsId),
            new DemoResult(
                accountRows.Count,
                months.Count,
                transactions.Count,
                goals.Count,
                loans.Count,
                savings.Count));
    }

    private static bool TryPersona(string? value, out Persona persona)
    {
        switch (value?.Trim().ToLowerInvariant())
        {
            case null or "":
            case "balanced":
                persona = Persona.Balanced;
                return true;
            case "saver":
                persona = Persona.Saver;
                return true;
            case "indebted":
                persona = Persona.Indebted;
                return true;
            default:
                persona = Persona.Balanced;
                return false;
        }
    }

    private static (string Name, string Type)[] AccountsFor(Persona persona) => persona switch
    {
        Persona.Saver => SaverAccounts,
        Persona.Indebted => IndebtedAccounts,
        _ => BalancedAccounts,
    };

    private static Goal[] GoalsFor(Persona persona) => persona switch
    {
        Persona.Saver => SaverGoals,
        Persona.Indebted => IndebtedGoals,
        _ => BalancedGoals,
    };

    private static Loan[] LoansFor(Persona persona) => persona switch
    {
        Persona.Saver => SaverLoans,
        Persona.Indebted => IndebtedLoans,
        _ => BalancedLoans,
    };

    private static SavingsRecord[] SavingsFor(Persona persona) => persona switch
    {
        Persona.Saver => SaverSavings,
        Persona.Balanced => BalancedSavings,
        _ => [],
    };

    /// <summary>How many months the period covers, which is what the guard rails measure.</summary>
    private static int Months(DemoRequest request) =>
        (request.EndYear - request.StartYear) * 12 + request.EndMonth - request.StartMonth + 1;

    private static IEnumerable<(int Year, int Month)> MonthsOf(DemoRequest request)
    {
        var year = request.StartYear;
        var month = request.StartMonth;

        for (var taken = 0; taken < Months(request); taken++)
        {
            yield return (year, month);

            if (++month > 12)
            {
                month = 1;
                year++;
            }
        }
    }

    private static (int Year, int Month) MonthsBefore(int year, int month, int count)
    {
        var from = new DateTime(year, month, 1).AddMonths(-count);

        return (from.Year, from.Month);
    }

    /// <summary>An amount with a little variation, the way a real month differs from a budget.</summary>
    private static decimal WithNoise(decimal amount, decimal fraction, Random random)
    {
        var noise = ((decimal)random.NextDouble() * 2 - 1) * fraction;

        return Cents(Math.Max(0.01m, amount * (1 + noise)));
    }

    /// <summary>Cents, rounded the way the site rounds: half always up.</summary>
    private static decimal Cents(decimal value) => Math.Floor(value * 100 + 0.5m) / 100;
}
