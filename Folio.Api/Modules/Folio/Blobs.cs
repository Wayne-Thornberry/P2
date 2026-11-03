using System.Text.Json.Serialization;

namespace Folio.Api.Modules.Folio;

// ── The wire shapes ─────────────────────────────────────────────────────────────────────
// One record per collection the site keeps, named after the shapes its stores already
// read and write. Keeping them identical is what lets the site swap localStorage for the
// API without touching the logic that uses the data.
//
// Optional members are nullable and are left out of the response when null (see
// Program.cs), because the site treats an absent field as "never set" rather than false.

public sealed record AccountDto(
    string Id,
    string Name,
    string? Type,
    bool? ExcludeFromBudget,
    bool? Archived,
    string? BankId);

public sealed record AccountsBlob(List<AccountDto>? Accounts, int? NextId);

public sealed record TransactionDto(
    int Id,
    string Name,
    DateOnly Date,
    DateTime CreatedAt,
    decimal Amount,
    string Type,
    int? ItemId,
    string? AccountId,
    string? Notes,
    bool? Flagged,
    bool? Locked,
    bool? Recurring);

public sealed record TransactionsBlob(List<TransactionDto>? Transactions, int? NextId);

public sealed record UpcomingDto(
    int Id,
    string Title,
    decimal Amount,
    string Type,
    DateOnly Date,
    string? Notes,
    bool Done,
    int? LinkedTransactionId,
    DateTime CreatedAt,
    string? Recurring);

public sealed record UpcomingBlob(List<UpcomingDto>? Items, int? NextId);

public sealed record BudgetItemDto(int Id, string Name);

public sealed record BudgetEntryDto(int ItemId, decimal Assigned, string Category);

public sealed record BudgetBlob(
    List<BudgetItemDto>? GlobalItems,
    Dictionary<string, Dictionary<string, List<BudgetEntryDto>>>? MonthlyEntries,
    int? NextId);

public sealed record TemplateBlob(List<BudgetEntryDto>? Entries);

public sealed record ContributionDto(int Id, DateOnly Date, decimal Amount, string? Note);

public sealed record SavingsGoalDto(
    int Id,
    string Name,
    decimal TargetAmount,
    DateOnly? Deadline,
    string Color,
    string? LinkedAccountId,
    List<ContributionDto>? Contributions,
    DateTime CreatedAt,
    bool Archived);

public sealed record SavingsGoalsBlob(List<SavingsGoalDto>? Goals, int? NextGoalId, int? NextContribId);

public sealed record LoanDto(
    int Id,
    string Name,
    decimal Principal,
    decimal Apr,
    int TermMonths,
    DateOnly StartDate,
    string? LinkedAccountId,
    string Color,
    DateTime CreatedAt,
    bool Archived);

public sealed record SavingsRecordDto(
    int Id,
    string Name,
    decimal Apr,
    string CompoundFreq,
    decimal StartBalance,
    DateOnly StartDate,
    string? LinkedAccountId,
    string Color,
    DateTime CreatedAt,
    bool Archived);

public sealed record FinanceBlob(
    List<LoanDto>? Loans,
    List<SavingsRecordDto>? Savings,
    int? NextLoanId,
    int? NextSavId);

public sealed record PlannerItemDto(int Id, string Name, decimal Amount);

public sealed record SimulationItemDto(
    int Id,
    string Name,
    decimal Amount,
    string Kind,
    string Source,
    int? TransactionId,
    int? PlannerItemId);

public sealed record SimulationDto(int Id, string Name, string Month, List<SimulationItemDto>? Items);

public sealed record PlannerBlob(
    decimal? Income,
    List<PlannerItemDto>? Items,
    List<SimulationDto>? Simulations,
    int? IdealSimulationId,
    int? NextId,
    int? NextSimId,
    int? NextSimItemId);

public sealed record ImportRecordDto(
    int Id,
    DateTime Date,
    string BankName,
    string AdapterId,
    string FileName,
    int RowCount);

public sealed record ImportHistoryBlob(List<ImportRecordDto>? Imports, int? NextId);

public sealed record SettingsBlob(
    string Theme,
    string Locale,
    string Currency,
    string DateStyle,
    string TimeStyle,
    string? Country,
    int? BillableMonthStart,
    int? BalanceCutoffTxId);

/// <summary>
/// Everything the site holds for one country, in one answer.
///
/// A collection that has never been saved is null rather than empty, so the site keeps
/// its own first-run defaults (a template budget, an id to start from) instead of being
/// handed a blank slate it did not ask for.
/// </summary>
public sealed class WorkspaceResponse
{
    [JsonPropertyName("folio_accounts")]
    public AccountsBlob? Accounts { get; init; }

    [JsonPropertyName("folio_transactions")]
    public TransactionsBlob? Transactions { get; init; }

    [JsonPropertyName("folio_upcoming")]
    public UpcomingBlob? Upcoming { get; init; }

    [JsonPropertyName("folio_budget")]
    public BudgetBlob? Budget { get; init; }

    [JsonPropertyName("folio_template")]
    public TemplateBlob? Template { get; init; }

    [JsonPropertyName("folio_savings_goals")]
    public SavingsGoalsBlob? SavingsGoals { get; init; }

    [JsonPropertyName("folio_finance")]
    public FinanceBlob? Finance { get; init; }

    [JsonPropertyName("folio_planner")]
    public PlannerBlob? Planner { get; init; }

    [JsonPropertyName("folio_import_history")]
    public ImportHistoryBlob? ImportHistory { get; init; }
}

/// <summary>The counter names, which are also the store names without their prefix.</summary>
public static class CounterNames
{
    public const string Accounts = "accounts";
    public const string Transactions = "transactions";
    public const string Upcoming = "upcoming";
    public const string Budget = "budget";
    public const string SavingsGoals = "savingsGoals";
    public const string SavingsContributions = "savingsContributions";
    public const string Loans = "loans";
    public const string SavingsRecords = "savingsRecords";
    public const string Planner = "planner";
    public const string Simulations = "simulations";
    public const string SimulationItems = "simulationItems";
    public const string ImportHistory = "importHistory";
}
