using Microsoft.EntityFrameworkCore;
using Folio.Api.Data;

namespace Folio.Api.Modules.Folio;

/// <summary>
/// Reads and writes the site's own collections.
///
/// The site keeps each area of its state as one aggregate -- accounts, transactions, the
/// budget, and so on -- and writes the whole aggregate when it changes, so this is where
/// an aggregate becomes rows and rows become an aggregate again. Every write replaces the
/// rows for one user and one country inside a transaction, which is the only way a save
/// that half-succeeded could exist.
/// </summary>
public sealed class WorkspaceService(FolioDbContext db)
{
    // ── Settings ────────────────────────────────────────────────────────────────────────

    public async Task<SettingsBlob?> ReadSettingsAsync(int userId, CancellationToken cancellationToken)
    {
        var row = await db.Settings.AsNoTracking().FirstOrDefaultAsync(s => s.UserId == userId, cancellationToken);

        return row is null
            ? null
            : new SettingsBlob(
                row.Theme,
                row.Locale,
                row.Currency,
                row.DateStyle,
                row.TimeStyle,
                row.Country,
                row.BillableMonthStart,
                row.BalanceCutoffTxId);
    }

    public async Task SaveSettingsAsync(int userId, SettingsBlob blob, CancellationToken cancellationToken)
    {
        var row = await db.Settings.FirstOrDefaultAsync(s => s.UserId == userId, cancellationToken);

        if (row is null)
        {
            row = new Settings { UserId = userId };
            db.Settings.Add(row);
        }

        row.Theme = Text(blob.Theme, "light", 16);
        row.Locale = Text(blob.Locale, "en-IE", 32);
        row.Currency = Text(blob.Currency, "EUR", 3);
        row.DateStyle = Text(blob.DateStyle, "medium", 8);
        row.TimeStyle = Text(blob.TimeStyle, "24h", 4);
        row.Country = Optional(blob.Country, 40);
        row.BillableMonthStart = (byte)Math.Clamp(blob.BillableMonthStart ?? 1, 1, 28);
        row.BalanceCutoffTxId = blob.BalanceCutoffTxId;

        await db.SaveChangesAsync(cancellationToken);
    }

    // ── The whole workspace ─────────────────────────────────────────────────────────────

    public async Task<WorkspaceResponse> ReadAsync(int userId, string country, CancellationToken cancellationToken) =>
        new()
        {
            Accounts = await ReadAccountsAsync(userId, country, cancellationToken),
            Transactions = await ReadTransactionsAsync(userId, country, cancellationToken),
            Upcoming = await ReadUpcomingAsync(userId, country, cancellationToken),
            Budget = await ReadBudgetAsync(userId, country, cancellationToken),
            Template = await ReadTemplateAsync(userId, country, cancellationToken),
            SavingsGoals = await ReadSavingsGoalsAsync(userId, country, cancellationToken),
            Finance = await ReadFinanceAsync(userId, country, cancellationToken),
            Planner = await ReadPlannerAsync(userId, country, cancellationToken),
            ImportHistory = await ReadImportHistoryAsync(userId, country, cancellationToken),
        };

    /// <summary>
    /// Every country this account has anything saved for, which is what an export of all
    /// countries is built from.
    ///
    /// The union is over the three tables a budget cannot exist without rather than
    /// every table: a country with no accounts and no transactions is a country with
    /// nothing to export.
    /// </summary>
    public async Task<IReadOnlyList<string>> ListCountriesAsync(int userId, CancellationToken cancellationToken)
    {
        var fromCounters = db.Counters.Where(row => row.UserId == userId).Select(row => row.Country);
        var fromAccounts = db.Accounts.Where(row => row.UserId == userId).Select(row => row.Country);
        var fromTransactions = db.Transactions.Where(row => row.UserId == userId).Select(row => row.Country);

        return await fromCounters
            .Union(fromAccounts)
            .Union(fromTransactions)
            .OrderBy(country => country)
            .ToListAsync(cancellationToken);
    }

    // ── Accounts ────────────────────────────────────────────────────────────────────────

    private async Task<AccountsBlob?> ReadAccountsAsync(int userId, string country, CancellationToken cancellationToken)
    {
        var rows = await db.Accounts.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return null;

        var accounts = rows
            .Select(row => new AccountDto(row.Id, row.Name, row.Type, row.ExcludeFromBudget, row.Archived, row.BankId))
            .ToList();

        return new AccountsBlob(accounts, await ReadCounterAsync(userId, country, CounterNames.Accounts, cancellationToken));
    }

    public async Task SaveAccountsAsync(int userId, string country, AccountsBlob blob, CancellationToken cancellationToken)
    {
        var rows = (blob.Accounts ?? [])
            .Where(account => !string.IsNullOrWhiteSpace(account.Id))
            .Select((account, index) => new Account
            {
                UserId = userId,
                Country = country,
                Id = account.Id.Trim(),
                Name = Text(account.Name, account.Id, 100),
                Type = Optional(account.Type, 16),
                ExcludeFromBudget = account.ExcludeFromBudget,
                Archived = account.Archived,
                BankId = Optional(account.BankId, 32),
                SortOrder = index,
            })
            .ToList();

        await ReplaceAsync(
            db.Accounts.Where(row => row.UserId == userId && row.Country == country),
            rows,
            cancellationToken);

        await SetCounterAsync(userId, country, CounterNames.Accounts, blob.NextId, cancellationToken);
    }

    // ── Transactions ────────────────────────────────────────────────────────────────────

    private async Task<TransactionsBlob?> ReadTransactionsAsync(int userId, string country, CancellationToken cancellationToken)
    {
        var rows = await db.Transactions.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return null;

        var transactions = rows
            .Select(row => new TransactionDto(
                row.Id,
                row.Name,
                row.Date,
                Utc(row.CreatedAt),
                row.Amount,
                row.Type,
                row.ItemId,
                row.AccountId,
                row.Notes,
                row.Flagged,
                row.Locked,
                row.Recurring))
            .ToList();

        return new TransactionsBlob(
            transactions,
            await ReadCounterAsync(userId, country, CounterNames.Transactions, cancellationToken));
    }

    public async Task SaveTransactionsAsync(int userId, string country, TransactionsBlob blob, CancellationToken cancellationToken)
    {
        var rows = (blob.Transactions ?? [])
            .Select((transaction, index) => new TransactionRow
            {
                UserId = userId,
                Country = country,
                Id = transaction.Id,
                Name = Text(transaction.Name, "Transaction", 200),
                Date = transaction.Date,
                CreatedAt = UtcInput(transaction.CreatedAt),
                Amount = transaction.Amount,
                Type = transaction.Type == "in" ? "in" : "out",
                ItemId = transaction.ItemId,
                AccountId = Optional(transaction.AccountId, 32),
                Notes = Optional(transaction.Notes, 1000),
                Flagged = transaction.Flagged,
                Locked = transaction.Locked,
                Recurring = transaction.Recurring,
                SortOrder = index,
            })
            .ToList();

        await ReplaceAsync(
            db.Transactions.Where(row => row.UserId == userId && row.Country == country),
            rows,
            cancellationToken);

        await SetCounterAsync(userId, country, CounterNames.Transactions, blob.NextId, cancellationToken);
    }

    // ── Upcoming transactions ───────────────────────────────────────────────────────────

    private async Task<UpcomingBlob?> ReadUpcomingAsync(int userId, string country, CancellationToken cancellationToken)
    {
        var rows = await db.UpcomingTransactions.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return null;

        var items = rows
            .Select(row => new UpcomingDto(
                row.Id,
                row.Title,
                row.Amount,
                row.Type,
                row.Date,
                row.Notes,
                row.Done,
                row.LinkedTransactionId,
                Utc(row.CreatedAt),
                row.Recurring))
            .ToList();

        return new UpcomingBlob(items, await ReadCounterAsync(userId, country, CounterNames.Upcoming, cancellationToken));
    }

    public async Task SaveUpcomingAsync(int userId, string country, UpcomingBlob blob, CancellationToken cancellationToken)
    {
        var rows = (blob.Items ?? [])
            .Select((item, index) => new UpcomingTransactionRow
            {
                UserId = userId,
                Country = country,
                Id = item.Id,
                Title = Text(item.Title, "Planned", 200),
                Amount = item.Amount,
                Type = item.Type == "in" ? "in" : "out",
                Date = item.Date,
                Notes = Optional(item.Notes, 1000),
                Done = item.Done,
                LinkedTransactionId = item.LinkedTransactionId,
                CreatedAt = UtcInput(item.CreatedAt),
                Recurring = item.Recurring is "weekly" or "monthly" or "yearly" ? item.Recurring : null,
                SortOrder = index,
            })
            .ToList();

        await ReplaceAsync(
            db.UpcomingTransactions.Where(row => row.UserId == userId && row.Country == country),
            rows,
            cancellationToken);

        await SetCounterAsync(userId, country, CounterNames.Upcoming, blob.NextId, cancellationToken);
    }

    // ── Budget ──────────────────────────────────────────────────────────────────────────

    private async Task<BudgetBlob?> ReadBudgetAsync(int userId, string country, CancellationToken cancellationToken)
    {
        var items = await db.BudgetItems.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var assignments = await db.BudgetAssignments.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.Year).ThenBy(row => row.Month).ThenBy(row => row.ItemId)
            .ToListAsync(cancellationToken);

        if (items.Count == 0 && assignments.Count == 0)
            return null;

        var months = new Dictionary<string, Dictionary<string, List<BudgetEntryDto>>>();

        foreach (var row in assignments)
        {
            var year = row.Year.ToString(System.Globalization.CultureInfo.InvariantCulture);
            var month = row.Month.ToString(System.Globalization.CultureInfo.InvariantCulture);

            if (!months.TryGetValue(year, out var byMonth))
                months[year] = byMonth = [];

            if (!byMonth.TryGetValue(month, out var entries))
                byMonth[month] = entries = [];

            entries.Add(new BudgetEntryDto(row.ItemId, row.Assigned, row.Category));
        }

        return new BudgetBlob(
            items.Select(row => new BudgetItemDto(row.Id, row.Name)).ToList(),
            months,
            await ReadCounterAsync(userId, country, CounterNames.Budget, cancellationToken));
    }

    public async Task SaveBudgetAsync(int userId, string country, BudgetBlob blob, CancellationToken cancellationToken)
    {
        var items = (blob.GlobalItems ?? [])
            .Select((item, index) => new BudgetItem
            {
                UserId = userId,
                Country = country,
                Id = item.Id,
                Name = Text(item.Name, "Item", 100),
                SortOrder = index,
            })
            .ToList();

        var assignments = new List<BudgetAssignment>();

        foreach (var (yearText, byMonth) in blob.MonthlyEntries ?? [])
        {
            if (!short.TryParse(yearText, out var year))
                continue;

            foreach (var (monthText, entries) in byMonth ?? [])
            {
                if (!byte.TryParse(monthText, out var month) || month is < 1 or > 12)
                    continue;

                foreach (var entry in entries ?? [])
                {
                    assignments.Add(new BudgetAssignment
                    {
                        UserId = userId,
                        Country = country,
                        Year = year,
                        Month = month,
                        ItemId = entry.ItemId,
                        Assigned = entry.Assigned,
                        Category = Text(entry.Category, "", 100),
                    });
                }
            }
        }

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        await db.BudgetAssignments.Where(row => row.UserId == userId && row.Country == country).ExecuteDeleteAsync(cancellationToken);
        await ReplaceAsync(db.BudgetItems.Where(row => row.UserId == userId && row.Country == country), items, cancellationToken);

        db.BudgetAssignments.AddRange(assignments);
        await db.SaveChangesAsync(cancellationToken);

        await SetCounterAsync(userId, country, CounterNames.Budget, blob.NextId, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }

    // ── Budget template ────────────────────────────────────────────────────────────────

    private async Task<TemplateBlob?> ReadTemplateAsync(int userId, string country, CancellationToken cancellationToken)
    {
        var rows = await db.BudgetTemplateEntries.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        return rows.Count == 0
            ? null
            : new TemplateBlob(rows.Select(row => new BudgetEntryDto(row.ItemId, row.Assigned, row.Category)).ToList());
    }

    public async Task SaveTemplateAsync(int userId, string country, TemplateBlob blob, CancellationToken cancellationToken)
    {
        var rows = (blob.Entries ?? [])
            .Select((entry, index) => new BudgetTemplateEntry
            {
                UserId = userId,
                Country = country,
                ItemId = entry.ItemId,
                Assigned = entry.Assigned,
                Category = Text(entry.Category, "", 100),
                SortOrder = index,
            })
            .ToList();

        await ReplaceAsync(
            db.BudgetTemplateEntries.Where(row => row.UserId == userId && row.Country == country),
            rows,
            cancellationToken);
    }

    // ── Savings goals ──────────────────────────────────────────────────────────────────

    private async Task<SavingsGoalsBlob?> ReadSavingsGoalsAsync(int userId, string country, CancellationToken cancellationToken)
    {
        var goals = await db.SavingsGoals.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var contributions = await db.SavingsContributions.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (goals.Count == 0)
            return null;

        var byGoal = contributions
            .GroupBy(row => row.GoalId)
            .ToDictionary(group => group.Key, group => group
                .Select(row => new ContributionDto(row.Id, row.Date, row.Amount, row.Note))
                .ToList());

        var dtos = goals
            .Select(row => new SavingsGoalDto(
                row.Id,
                row.Name,
                row.TargetAmount,
                row.Deadline,
                row.Color,
                row.LinkedAccountId,
                byGoal.TryGetValue(row.Id, out var list) ? list : [],
                Utc(row.CreatedAt),
                row.Archived))
            .ToList();

        return new SavingsGoalsBlob(
            dtos,
            await ReadCounterAsync(userId, country, CounterNames.SavingsGoals, cancellationToken),
            await ReadCounterAsync(userId, country, CounterNames.SavingsContributions, cancellationToken));
    }

    public async Task SaveSavingsGoalsAsync(int userId, string country, SavingsGoalsBlob blob, CancellationToken cancellationToken)
    {
        var goals = (blob.Goals ?? [])
            .Select((goal, index) => new SavingsGoal
            {
                UserId = userId,
                Country = country,
                Id = goal.Id,
                Name = Text(goal.Name, "Goal", 100),
                TargetAmount = goal.TargetAmount,
                Deadline = goal.Deadline,
                Color = Text(goal.Color, "#6366f1", 32),
                LinkedAccountId = Optional(goal.LinkedAccountId, 32),
                CreatedAt = UtcInput(goal.CreatedAt),
                Archived = goal.Archived,
                SortOrder = index,
            })
            .ToList();

        var contributions = (blob.Goals ?? [])
            .SelectMany(goal => (goal.Contributions ?? []).Select((contribution, index) => new SavingsContribution
            {
                UserId = userId,
                Country = country,
                Id = contribution.Id,
                GoalId = goal.Id,
                Date = contribution.Date,
                Amount = contribution.Amount,
                Note = Optional(contribution.Note, 500),
                SortOrder = index,
            }))
            .ToList();

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // The contributions point at the goals, so they go first.
        await db.SavingsContributions.Where(row => row.UserId == userId && row.Country == country).ExecuteDeleteAsync(cancellationToken);
        await ReplaceAsync(db.SavingsGoals.Where(row => row.UserId == userId && row.Country == country), goals, cancellationToken);

        db.SavingsContributions.AddRange(contributions);
        await db.SaveChangesAsync(cancellationToken);

        await SetCounterAsync(userId, country, CounterNames.SavingsGoals, blob.NextGoalId, cancellationToken);
        await SetCounterAsync(userId, country, CounterNames.SavingsContributions, blob.NextContribId, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }

    // ── Loans and savings records ──────────────────────────────────────────────────────

    private async Task<FinanceBlob?> ReadFinanceAsync(int userId, string country, CancellationToken cancellationToken)
    {
        var loans = await db.Loans.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var savings = await db.SavingsRecords.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (loans.Count == 0 && savings.Count == 0)
            return null;

        return new FinanceBlob(
            loans.Select(row => new LoanDto(
                row.Id,
                row.Name,
                row.Principal,
                row.Apr,
                row.TermMonths,
                row.StartDate,
                row.LinkedAccountId,
                row.Color,
                Utc(row.CreatedAt),
                row.Archived)).ToList(),
            savings.Select(row => new SavingsRecordDto(
                row.Id,
                row.Name,
                row.Apr,
                row.CompoundFreq,
                row.StartBalance,
                row.StartDate,
                row.LinkedAccountId,
                row.Color,
                Utc(row.CreatedAt),
                row.Archived)).ToList(),
            await ReadCounterAsync(userId, country, CounterNames.Loans, cancellationToken),
            await ReadCounterAsync(userId, country, CounterNames.SavingsRecords, cancellationToken));
    }

    public async Task SaveFinanceAsync(int userId, string country, FinanceBlob blob, CancellationToken cancellationToken)
    {
        var loans = (blob.Loans ?? [])
            .Select((loan, index) => new Loan
            {
                UserId = userId,
                Country = country,
                Id = loan.Id,
                Name = Text(loan.Name, "Loan", 100),
                Principal = loan.Principal,
                Apr = loan.Apr,
                TermMonths = loan.TermMonths,
                StartDate = loan.StartDate,
                LinkedAccountId = Optional(loan.LinkedAccountId, 32),
                Color = Text(loan.Color, "#6366f1", 32),
                CreatedAt = UtcInput(loan.CreatedAt),
                Archived = loan.Archived,
                SortOrder = index,
            })
            .ToList();

        var savings = (blob.Savings ?? [])
            .Select((record, index) => new SavingsRecord
            {
                UserId = userId,
                Country = country,
                Id = record.Id,
                Name = Text(record.Name, "Savings", 100),
                Apr = record.Apr,
                CompoundFreq = record.CompoundFreq is "monthly" or "quarterly" or "annually" ? record.CompoundFreq : "monthly",
                StartBalance = record.StartBalance,
                StartDate = record.StartDate,
                LinkedAccountId = Optional(record.LinkedAccountId, 32),
                Color = Text(record.Color, "#6366f1", 32),
                CreatedAt = UtcInput(record.CreatedAt),
                Archived = record.Archived,
                SortOrder = index,
            })
            .ToList();

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        await ReplaceAsync(db.Loans.Where(row => row.UserId == userId && row.Country == country), loans, cancellationToken);
        await ReplaceAsync(db.SavingsRecords.Where(row => row.UserId == userId && row.Country == country), savings, cancellationToken);

        await SetCounterAsync(userId, country, CounterNames.Loans, blob.NextLoanId, cancellationToken);
        await SetCounterAsync(userId, country, CounterNames.SavingsRecords, blob.NextSavId, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }

    // ── Planner ─────────────────────────────────────────────────────────────────────────

    private async Task<PlannerBlob?> ReadPlannerAsync(int userId, string country, CancellationToken cancellationToken)
    {
        var state = await db.PlannerState.AsNoTracking()
            .FirstOrDefaultAsync(row => row.UserId == userId && row.Country == country, cancellationToken);

        var items = await db.PlannerItems.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var simulations = await db.PlannerSimulations.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        var simulationItems = await db.PlannerSimulationItems.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (state is null && items.Count == 0 && simulations.Count == 0)
            return null;

        var bySimulation = simulationItems
            .GroupBy(row => row.SimulationId)
            .ToDictionary(group => group.Key, group => group
                .Select(row => new SimulationItemDto(
                    row.Id,
                    row.Name,
                    row.Amount,
                    row.Kind,
                    row.Source,
                    row.TransactionId,
                    row.PlannerItemId))
                .ToList());

        return new PlannerBlob(
            state?.Income,
            items.Select(row => new PlannerItemDto(row.Id, row.Name, row.Amount)).ToList(),
            simulations.Select(row => new SimulationDto(
                row.Id,
                row.Name,
                row.Month,
                bySimulation.TryGetValue(row.Id, out var list) ? list : [])).ToList(),
            state?.IdealSimulationId,
            await ReadCounterAsync(userId, country, CounterNames.Planner, cancellationToken),
            await ReadCounterAsync(userId, country, CounterNames.Simulations, cancellationToken),
            await ReadCounterAsync(userId, country, CounterNames.SimulationItems, cancellationToken));
    }

    public async Task SavePlannerAsync(int userId, string country, PlannerBlob blob, CancellationToken cancellationToken)
    {
        var items = (blob.Items ?? [])
            .Select((item, index) => new PlannerItem
            {
                UserId = userId,
                Country = country,
                Id = item.Id,
                Name = Text(item.Name, "Item", 100),
                Amount = item.Amount,
                SortOrder = index,
            })
            .ToList();

        var simulations = (blob.Simulations ?? [])
            .Select((simulation, index) => new PlannerSimulation
            {
                UserId = userId,
                Country = country,
                Id = simulation.Id,
                Name = Text(simulation.Name, "Scenario", 100),
                Month = Text(simulation.Month, "0000-00", 7),
                SortOrder = index,
            })
            .ToList();

        var simulationItems = (blob.Simulations ?? [])
            .SelectMany(simulation => (simulation.Items ?? []).Select((item, index) => new PlannerSimulationItem
            {
                UserId = userId,
                Country = country,
                Id = item.Id,
                SimulationId = simulation.Id,
                Name = Text(item.Name, "Item", 100),
                Amount = item.Amount,
                Kind = item.Kind == "income" ? "income" : "expense",
                Source = item.Source is "transaction" or "planner" or "custom" ? item.Source : "custom",
                TransactionId = item.TransactionId,
                PlannerItemId = item.PlannerItemId,
                SortOrder = index,
            }))
            .ToList();

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        await db.PlannerSimulationItems.Where(row => row.UserId == userId && row.Country == country).ExecuteDeleteAsync(cancellationToken);
        await ReplaceAsync(db.PlannerSimulations.Where(row => row.UserId == userId && row.Country == country), simulations, cancellationToken);
        await ReplaceAsync(db.PlannerItems.Where(row => row.UserId == userId && row.Country == country), items, cancellationToken);

        db.PlannerSimulationItems.AddRange(simulationItems);

        var state = await db.PlannerState.FirstOrDefaultAsync(
            row => row.UserId == userId && row.Country == country, cancellationToken);

        if (state is null)
        {
            state = new PlannerState { UserId = userId, Country = country };
            db.PlannerState.Add(state);
        }

        state.Income = blob.Income ?? 0;
        state.IdealSimulationId = blob.IdealSimulationId;

        await db.SaveChangesAsync(cancellationToken);

        await SetCounterAsync(userId, country, CounterNames.Planner, blob.NextId, cancellationToken);
        await SetCounterAsync(userId, country, CounterNames.Simulations, blob.NextSimId, cancellationToken);
        await SetCounterAsync(userId, country, CounterNames.SimulationItems, blob.NextSimItemId, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }

    // ── Import history ─────────────────────────────────────────────────────────────────

    private async Task<ImportHistoryBlob?> ReadImportHistoryAsync(int userId, string country, CancellationToken cancellationToken)
    {
        var rows = await db.ImportHistory.AsNoTracking()
            .Where(row => row.UserId == userId && row.Country == country)
            .OrderBy(row => row.SortOrder)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
            return null;

        var imports = rows
            .Select(row => new ImportRecordDto(row.Id, Utc(row.Date), row.BankName, row.AdapterId, row.FileName, row.RowCount))
            .ToList();

        return new ImportHistoryBlob(
            imports,
            await ReadCounterAsync(userId, country, CounterNames.ImportHistory, cancellationToken));
    }

    public async Task SaveImportHistoryAsync(int userId, string country, ImportHistoryBlob blob, CancellationToken cancellationToken)
    {
        var rows = (blob.Imports ?? [])
            .Select((import, index) => new ImportRecord
            {
                UserId = userId,
                Country = country,
                Id = import.Id,
                Date = UtcInput(import.Date),
                BankName = Text(import.BankName, "", 100),
                AdapterId = Text(import.AdapterId, "", 32),
                FileName = Text(import.FileName, "", 260),
                RowCount = import.RowCount,
                SortOrder = index,
            })
            .ToList();

        await ReplaceAsync(
            db.ImportHistory.Where(row => row.UserId == userId && row.Country == country),
            rows,
            cancellationToken);

        await SetCounterAsync(userId, country, CounterNames.ImportHistory, blob.NextId, cancellationToken);
    }

    // ── Shared helpers ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Deletes what is there and inserts what should be, without a tracker in the way.
    ///
    /// The delete is a statement rather than <c>RemoveRange</c> because a table keyed on
    /// (user, country, id) is re-inserting rows with the same key, and one SaveChanges
    /// would leave the order of the delete and the insert to EF.
    /// </summary>
    private async Task ReplaceAsync<T>(IQueryable<T> existing, List<T> rows, CancellationToken cancellationToken)
        where T : class
    {
        await existing.ExecuteDeleteAsync(cancellationToken);

        if (rows.Count > 0)
        {
            db.AddRange(rows);
            await db.SaveChangesAsync(cancellationToken);
        }
    }

    private async Task<int?> ReadCounterAsync(int userId, string country, string name, CancellationToken cancellationToken)
    {
        var row = await db.Counters.AsNoTracking()
            .FirstOrDefaultAsync(counter => counter.UserId == userId && counter.Country == country && counter.Name == name, cancellationToken);

        return row?.Value;
    }

    private async Task SetCounterAsync(int userId, string country, string name, int? value, CancellationToken cancellationToken)
    {
        if (value is not { } next)
            return;

        var row = await db.Counters.FirstOrDefaultAsync(
            counter => counter.UserId == userId && counter.Country == country && counter.Name == name, cancellationToken);

        if (row is null)
            db.Counters.Add(new Counter { UserId = userId, Country = country, Name = name, Value = next });
        else
            row.Value = next;

        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>A required value, trimmed and cut to the column's width, with a fallback.</summary>
    internal static string Text(string? value, string fallback, int maxLength)
    {
        var text = (value ?? "").Trim();

        if (text.Length == 0)
            text = fallback;

        return text.Length <= maxLength ? text : text[..maxLength];
    }

    /// <summary>A value that is absent rather than empty: the site treats the two differently.</summary>
    internal static string? Optional(string? value, int maxLength)
    {
        var text = value?.Trim();

        if (string.IsNullOrEmpty(text))
            return null;

        return text.Length <= maxLength ? text : text[..maxLength];
    }

    /// <summary>
    /// A timestamp read back out of SQL Server, which has forgotten it was UTC.
    ///
    /// The site writes ISO strings with a Z on the end, so answering without one would
    /// make a saved date read as local time.
    /// </summary>
    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    /// <summary>A timestamp on its way in, made UTC before it loses the information.</summary>
    private static DateTime UtcInput(DateTime value) =>
        value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
        };
}
