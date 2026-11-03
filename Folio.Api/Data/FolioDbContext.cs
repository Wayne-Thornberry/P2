using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Folio.Api.Modules.Folio;

namespace Folio.Api.Data;

/// <summary>
/// The whole database as the API sees it.
///
/// Every table mapped here is created by the model in Folio.Database; this class never
/// creates or alters one. Change the schema there, then bring the mapping into line: the
/// API's tests build a database from those scripts and run the app against it, so a
/// mapping that disagrees fails on the way in.
///
/// There is no users table and nothing is keyed on one. This is a budget on a private box
/// for one person, so every folio table is keyed on (Country, Id) -- the country is what
/// separates one budget from another.
///
/// The folio tables carry the client's own ids rather than an identity column of their
/// own. Folio allocates its ids in the browser and refers to them from other collections
/// (a budget item id on a transaction, an account id on a savings goal), so a key the
/// database invented would have to be translated on every save.
/// </summary>
public sealed class FolioDbContext(DbContextOptions<FolioDbContext> options) : DbContext(options)
{
    public DbSet<Settings> Settings => Set<Settings>();

    public DbSet<Counter> Counters => Set<Counter>();

    public DbSet<Account> Accounts => Set<Account>();

    public DbSet<TransactionRow> Transactions => Set<TransactionRow>();

    public DbSet<UpcomingTransactionRow> UpcomingTransactions => Set<UpcomingTransactionRow>();

    public DbSet<BudgetItem> BudgetItems => Set<BudgetItem>();

    public DbSet<BudgetAssignment> BudgetAssignments => Set<BudgetAssignment>();

    public DbSet<BudgetTemplateEntry> BudgetTemplateEntries => Set<BudgetTemplateEntry>();

    public DbSet<SavingsGoal> SavingsGoals => Set<SavingsGoal>();

    public DbSet<SavingsContribution> SavingsContributions => Set<SavingsContribution>();

    public DbSet<Loan> Loans => Set<Loan>();

    public DbSet<SavingsRecord> SavingsRecords => Set<SavingsRecord>();

    public DbSet<PlannerState> PlannerState => Set<PlannerState>();

    public DbSet<PlannerItem> PlannerItems => Set<PlannerItem>();

    public DbSet<PlannerSimulation> PlannerSimulations => Set<PlannerSimulation>();

    public DbSet<PlannerSimulationItem> PlannerSimulationItems => Set<PlannerSimulationItem>();

    public DbSet<ImportRecord> ImportHistory => Set<ImportRecord>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<Settings>(entity =>
        {
            entity.ToTable("Settings", FolioModule.SchemaName);
            entity.HasKey(settings => settings.Id);
            entity.Property(settings => settings.Id).ValueGeneratedNever();
            entity.Property(settings => settings.Theme).HasMaxLength(16).IsRequired();
            entity.Property(settings => settings.Locale).HasMaxLength(32).IsRequired();
            entity.Property(settings => settings.Currency).HasColumnType("char(3)").IsRequired();
            entity.Property(settings => settings.DateStyle).HasMaxLength(8).IsRequired();
            entity.Property(settings => settings.TimeStyle).HasMaxLength(4).IsRequired();
            entity.Property(settings => settings.Country).HasMaxLength(FolioModule.CountryMaxLength);
        });

        model.Entity<Counter>(entity =>
        {
            entity.ToTable("Counters", FolioModule.SchemaName);
            entity.HasKey(counter => new { counter.Country, counter.Name });
            Country(entity.Property(counter => counter.Country));
            entity.Property(counter => counter.Name).HasMaxLength(40).IsRequired();
        });

        model.Entity<Account>(entity =>
        {
            entity.ToTable("Accounts", FolioModule.SchemaName);
            entity.HasKey(account => new { account.Country, account.Id });
            Country(entity.Property(account => account.Country));
            entity.Property(account => account.Id).HasMaxLength(32).IsRequired();
            entity.Property(account => account.Name).HasMaxLength(100).IsRequired();
            entity.Property(account => account.Type).HasMaxLength(16);
            entity.Property(account => account.BankId).HasMaxLength(32);
        });

        model.Entity<TransactionRow>(entity =>
        {
            entity.ToTable("Transactions", FolioModule.SchemaName);
            entity.HasKey(transaction => new { transaction.Country, transaction.Id });
            Country(entity.Property(transaction => transaction.Country));
            entity.Property(transaction => transaction.Name).HasMaxLength(200).IsRequired();
            entity.Property(transaction => transaction.Amount).HasColumnType("decimal(18,4)");
            entity.Property(transaction => transaction.Type).HasMaxLength(3).IsRequired();
            entity.Property(transaction => transaction.AccountId).HasMaxLength(32);
            entity.Property(transaction => transaction.Notes).HasMaxLength(1000);
        });

        model.Entity<UpcomingTransactionRow>(entity =>
        {
            entity.ToTable("UpcomingTransactions", FolioModule.SchemaName);
            entity.HasKey(item => new { item.Country, item.Id });
            Country(entity.Property(item => item.Country));
            entity.Property(item => item.Title).HasMaxLength(200).IsRequired();
            entity.Property(item => item.Amount).HasColumnType("decimal(18,4)");
            entity.Property(item => item.Type).HasMaxLength(3).IsRequired();
            entity.Property(item => item.Notes).HasMaxLength(1000);
            entity.Property(item => item.Recurring).HasMaxLength(8);
        });

        model.Entity<BudgetItem>(entity =>
        {
            entity.ToTable("BudgetItems", FolioModule.SchemaName);
            entity.HasKey(item => new { item.Country, item.Id });
            Country(entity.Property(item => item.Country));
            entity.Property(item => item.Name).HasMaxLength(100).IsRequired();
        });

        model.Entity<BudgetAssignment>(entity =>
        {
            entity.ToTable("BudgetAssignments", FolioModule.SchemaName);
            entity.HasKey(entry => new { entry.Country, entry.Year, entry.Month, entry.ItemId });
            Country(entity.Property(entry => entry.Country));
            entity.Property(entry => entry.Assigned).HasColumnType("decimal(18,4)");
            entity.Property(entry => entry.Category).HasMaxLength(100).IsRequired();
        });

        model.Entity<BudgetTemplateEntry>(entity =>
        {
            entity.ToTable("BudgetTemplateEntries", FolioModule.SchemaName);
            entity.HasKey(entry => new { entry.Country, entry.ItemId });
            Country(entity.Property(entry => entry.Country));
            entity.Property(entry => entry.Assigned).HasColumnType("decimal(18,4)");
            entity.Property(entry => entry.Category).HasMaxLength(100).IsRequired();
        });

        model.Entity<SavingsGoal>(entity =>
        {
            entity.ToTable("SavingsGoals", FolioModule.SchemaName);
            entity.HasKey(goal => new { goal.Country, goal.Id });
            Country(entity.Property(goal => goal.Country));
            entity.Property(goal => goal.Name).HasMaxLength(100).IsRequired();
            entity.Property(goal => goal.TargetAmount).HasColumnType("decimal(18,4)");
            entity.Property(goal => goal.Color).HasMaxLength(32).IsRequired();
            entity.Property(goal => goal.LinkedAccountId).HasMaxLength(32);
        });

        model.Entity<SavingsContribution>(entity =>
        {
            entity.ToTable("SavingsContributions", FolioModule.SchemaName);
            entity.HasKey(contribution => new { contribution.Country, contribution.Id });
            Country(entity.Property(contribution => contribution.Country));
            entity.Property(contribution => contribution.Amount).HasColumnType("decimal(18,4)");
            entity.Property(contribution => contribution.Note).HasMaxLength(500);
            entity.HasOne<SavingsGoal>()
                  .WithMany()
                  .HasForeignKey(contribution => new { contribution.Country, contribution.GoalId })
                  .OnDelete(DeleteBehavior.NoAction);
        });

        model.Entity<Loan>(entity =>
        {
            entity.ToTable("Loans", FolioModule.SchemaName);
            entity.HasKey(loan => new { loan.Country, loan.Id });
            Country(entity.Property(loan => loan.Country));
            entity.Property(loan => loan.Name).HasMaxLength(100).IsRequired();
            entity.Property(loan => loan.Principal).HasColumnType("decimal(18,4)");
            entity.Property(loan => loan.Apr).HasColumnType("decimal(9,6)");
            entity.Property(loan => loan.Color).HasMaxLength(32).IsRequired();
            entity.Property(loan => loan.LinkedAccountId).HasMaxLength(32);
        });

        model.Entity<SavingsRecord>(entity =>
        {
            entity.ToTable("SavingsRecords", FolioModule.SchemaName);
            entity.HasKey(record => new { record.Country, record.Id });
            Country(entity.Property(record => record.Country));
            entity.Property(record => record.Name).HasMaxLength(100).IsRequired();
            entity.Property(record => record.Apr).HasColumnType("decimal(9,6)");
            entity.Property(record => record.CompoundFreq).HasMaxLength(12).IsRequired();
            entity.Property(record => record.StartBalance).HasColumnType("decimal(18,4)");
            entity.Property(record => record.Color).HasMaxLength(32).IsRequired();
            entity.Property(record => record.LinkedAccountId).HasMaxLength(32);
        });

        model.Entity<PlannerState>(entity =>
        {
            entity.ToTable("PlannerState", FolioModule.SchemaName);
            entity.HasKey(state => new { state.Country });
            Country(entity.Property(state => state.Country));
            entity.Property(state => state.Income).HasColumnType("decimal(18,4)");
        });

        model.Entity<PlannerItem>(entity =>
        {
            entity.ToTable("PlannerItems", FolioModule.SchemaName);
            entity.HasKey(item => new { item.Country, item.Id });
            Country(entity.Property(item => item.Country));
            entity.Property(item => item.Name).HasMaxLength(100).IsRequired();
            entity.Property(item => item.Amount).HasColumnType("decimal(18,4)");
        });

        model.Entity<PlannerSimulation>(entity =>
        {
            entity.ToTable("PlannerSimulations", FolioModule.SchemaName);
            entity.HasKey(simulation => new { simulation.Country, simulation.Id });
            Country(entity.Property(simulation => simulation.Country));
            entity.Property(simulation => simulation.Name).HasMaxLength(100).IsRequired();
            entity.Property(simulation => simulation.Month).HasColumnType("char(7)").IsRequired();
        });

        model.Entity<PlannerSimulationItem>(entity =>
        {
            entity.ToTable("PlannerSimulationItems", FolioModule.SchemaName);
            entity.HasKey(item => new { item.Country, item.Id });
            Country(entity.Property(item => item.Country));
            entity.Property(item => item.Name).HasMaxLength(100).IsRequired();
            entity.Property(item => item.Amount).HasColumnType("decimal(18,4)");
            entity.Property(item => item.Kind).HasMaxLength(8).IsRequired();
            entity.Property(item => item.Source).HasMaxLength(16).IsRequired();
            entity.HasOne<PlannerSimulation>()
                  .WithMany()
                  .HasForeignKey(item => new { item.Country, item.SimulationId })
                  .OnDelete(DeleteBehavior.NoAction);
        });

        model.Entity<ImportRecord>(entity =>
        {
            entity.ToTable("ImportHistory", FolioModule.SchemaName);
            entity.HasKey(import => new { import.Country, import.Id });
            Country(entity.Property(import => import.Country));
            entity.Property(import => import.BankName).HasMaxLength(100).IsRequired();
            entity.Property(import => import.AdapterId).HasMaxLength(32).IsRequired();
            entity.Property(import => import.FileName).HasMaxLength(260).IsRequired();
        });
    }

    /// <summary>The country column, which is the first part of every key in this schema.</summary>
    private static void Country(PropertyBuilder<string> property) =>
        property.HasMaxLength(FolioModule.CountryMaxLength).IsRequired();
}
