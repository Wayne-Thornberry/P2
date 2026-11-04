namespace Folio.Api.Modules.Folio;

/// <summary>
/// A row that belongs to one country.
///
/// Every table in the folio schema carries it: one person may keep a budget for more than
/// one country, and each is a separate set of rows rather than a tagged pile.
/// </summary>
public interface ICountryScoped
{
    string Country { get; set; }
}

// ── Rows ────────────────────────────────────────────────────────────────────────────────
// One class per table in Folio.Database\Tables. The property names and lengths match the
// columns; nothing here creates or alters a table.

public sealed class Account : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Type { get; set; }
    public bool? ExcludeFromBudget { get; set; }
    public bool? Archived { get; set; }
    public string? BankId { get; set; }
    public int SortOrder { get; set; }
}

public sealed class TransactionRow : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public DateOnly Date { get; set; }
    public DateTime CreatedAt { get; set; }
    public decimal Amount { get; set; }
    public string Type { get; set; } = "";
    public int? ItemId { get; set; }
    public string? AccountId { get; set; }
    public string? Notes { get; set; }
    public bool? Flagged { get; set; }
    public bool? Locked { get; set; }
    public bool? Recurring { get; set; }
    public int SortOrder { get; set; }
}

public sealed class UpcomingTransactionRow : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public decimal Amount { get; set; }
    public string Type { get; set; } = "";
    public DateOnly Date { get; set; }
    public string? Notes { get; set; }
    public bool Done { get; set; }
    public int? LinkedTransactionId { get; set; }
    public DateTime CreatedAt { get; set; }
    public string? Recurring { get; set; }
    public int SortOrder { get; set; }
}

public sealed class BudgetItem : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int SortOrder { get; set; }
}

public sealed class BudgetAssignment : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public short Year { get; set; }
    public byte Month { get; set; }
    public int ItemId { get; set; }
    public decimal Assigned { get; set; }
    public string Category { get; set; } = "";
}

public sealed class BudgetTemplateEntry : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public int ItemId { get; set; }
    public decimal Assigned { get; set; }
    public string Category { get; set; } = "";
    public int SortOrder { get; set; }
}

public sealed class SavingsGoal : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public decimal TargetAmount { get; set; }
    public DateOnly? Deadline { get; set; }
    public string Color { get; set; } = "";
    public string? LinkedAccountId { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool Archived { get; set; }
    public int SortOrder { get; set; }
}

public sealed class SavingsContribution : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public int Id { get; set; }
    public int GoalId { get; set; }
    public DateOnly Date { get; set; }
    public decimal Amount { get; set; }
    public string? Note { get; set; }
    public int SortOrder { get; set; }
}

public sealed class Loan : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public decimal Principal { get; set; }
    public decimal Apr { get; set; }
    public int TermMonths { get; set; }
    public DateOnly StartDate { get; set; }
    public string? LinkedAccountId { get; set; }
    public string Color { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public bool Archived { get; set; }
    public int SortOrder { get; set; }
}

public sealed class SavingsRecord : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public decimal Apr { get; set; }
    public string CompoundFreq { get; set; } = "";
    public decimal StartBalance { get; set; }
    public DateOnly StartDate { get; set; }
    public string? LinkedAccountId { get; set; }
    public string Color { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public bool Archived { get; set; }
    public int SortOrder { get; set; }
}

public sealed class PlannerState : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public decimal Income { get; set; }
    public int? IdealSimulationId { get; set; }
}

public sealed class PlannerItem : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public decimal Amount { get; set; }
    public int SortOrder { get; set; }
}

public sealed class PlannerSimulation : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Month { get; set; } = "";
    public int SortOrder { get; set; }
}

public sealed class PlannerSimulationItem : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public int Id { get; set; }
    public int SimulationId { get; set; }
    public string Name { get; set; } = "";
    public decimal Amount { get; set; }
    public string Kind { get; set; } = "";
    public string Source { get; set; } = "";
    public int? TransactionId { get; set; }
    public int? PlannerItemId { get; set; }
    public int SortOrder { get; set; }
}

public sealed class ImportRecord : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public int Id { get; set; }
    public DateTime Date { get; set; }
    public string BankName { get; set; } = "";
    public string AdapterId { get; set; } = "";
    public string FileName { get; set; } = "";
    public int RowCount { get; set; }
    public int SortOrder { get; set; }
}

public sealed class Counter : ICountryScoped
{
    public int UserId { get; set; }
    public string Country { get; set; } = "";
    public string Name { get; set; } = "";
    public int Value { get; set; }
}

/// <summary>One person's preferences. The country it names is a column.</summary>
public sealed class Settings
{
    /// <summary>The account these are the preferences of, and the whole of the key.</summary>
    public int UserId { get; set; }

    public string Theme { get; set; } = "";
    public string Locale { get; set; } = "";
    public string Currency { get; set; } = "";
    public string DateStyle { get; set; } = "";
    public string TimeStyle { get; set; } = "";
    public string? Country { get; set; }
    public byte BillableMonthStart { get; set; } = 1;
    public int? BalanceCutoffTxId { get; set; }
}
