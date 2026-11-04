using Folio.Api.Auth;
using Folio.Api.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Folio.Api.Tests;

/// <summary>
/// The database as it was before there were accounts, and what the migration that added
/// them has to do to it: take every row that was already there and give it an owner,
/// without losing one.
///
/// This is the deploy's riskiest step -- a live database with somebody's budget in it -- so
/// the old shape is written out here in full rather than trusted to memory.
/// </summary>
public sealed class AccountMigrationTests : IDisposable
{
    private readonly string _database = $"Folio_Upgrade_{Guid.NewGuid():N}";

    private string ConnectionString => TestDatabase.ConnectionString(TestDatabase.Server, _database);

    [DatabaseFact]
    public void The_accounts_migration_gives_a_database_with_no_accounts_an_owner_and_keeps_its_rows()
    {
        CreateAccountlessDatabaseWithSomebodyBudgetInIt();

        TestDatabase.ApplyMigrations(ConnectionString);

        // Every row is still there, and every one of them is somebody's.
        Assert.Equal(3, Scalar("SELECT COUNT(*) FROM [folio].[Transactions] WHERE [UserId] IS NOT NULL"));
        Assert.Equal(1, Scalar("SELECT COUNT(*) FROM [folio].[Transactions] WHERE [Name] = N'Groceries'"));

        Assert.Equal(2, Scalar("SELECT COUNT(*) FROM [folio].[Accounts] WHERE [UserId] IS NOT NULL"));
        Assert.Equal(1, Scalar("SELECT COUNT(*) FROM [folio].[Settings] WHERE [UserId] IS NOT NULL"));
        Assert.Equal(1, Scalar("SELECT COUNT(*) FROM [folio].[SavingsGoals] WHERE [UserId] IS NOT NULL"));
        Assert.Equal(2, Scalar("SELECT COUNT(*) FROM [folio].[SavingsContributions] WHERE [UserId] IS NOT NULL"));
        Assert.Equal(2, Scalar("SELECT COUNT(*) FROM [folio].[BudgetAssignments] WHERE [UserId] IS NOT NULL"));
        Assert.Equal(1, Scalar("SELECT COUNT(*) FROM [folio].[PlannerState] WHERE [UserId] IS NOT NULL"));
        Assert.Equal(1, Scalar("SELECT COUNT(*) FROM [folio].[PlannerSimulationItems] WHERE [UserId] IS NOT NULL"));
        Assert.Equal(2, Scalar("SELECT COUNT(*) FROM [folio].[Counters] WHERE [UserId] IS NOT NULL"));

        // One account, and not one anybody can sign in as: it is the placeholder the first
        // account fills in, so it has a name and no credentials behind it.
        Assert.Equal(1, Scalar("SELECT COUNT(*) FROM [auth].[Users]"));
        Assert.Equal(AccountRules.UnclaimedUsername, (string)Scalar("SELECT [Username] FROM [auth].[Users]"));
        Assert.Equal(0, Scalar("SELECT COUNT(*) FROM [auth].[Users] WHERE [ClaimedAt] IS NOT NULL"));

        // ...and the budget points at it, in every table.
        Assert.Equal(
            1,
            Scalar("SELECT COUNT(DISTINCT [UserId]) FROM [folio].[Transactions]"));
        Assert.Equal(
            3,
            Scalar("SELECT COUNT(*) FROM [folio].[Transactions] AS t JOIN [auth].[Users] AS u ON u.[Id] = t.[UserId]"));
    }

    [DatabaseFact]
    public void The_migration_leaves_the_shape_the_model_describes()
    {
        CreateAccountlessDatabaseWithSomebodyBudgetInIt();

        TestDatabase.ApplyMigrations(ConnectionString);

        // The singleton's key moved from the constant Id to the account, and the column went.
        Assert.Equal(0, Scalar("SELECT COUNT(*) FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[Settings]') AND [name] = N'Id'"));
        Assert.Equal(
            1,
            Scalar("SELECT COUNT(*) FROM sys.index_columns WHERE [object_id] = OBJECT_ID(N'[folio].[Settings]') AND [key_ordinal] = 1 AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[Settings]'), N'UserId', 'ColumnId')"));

        // A transaction is this person's transaction in this country, so the country alone
        // is no longer the key.
        Assert.Equal(
            3,
            Scalar("""
                SELECT COUNT(*)
                FROM sys.index_columns
                WHERE [object_id] = OBJECT_ID(N'[folio].[Transactions]')
                  AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[Transactions]'), N'PK_Transactions', 'IndexId')
                  AND [key_ordinal] > 0
                """));

        // Nothing is nullable: a row without an owner would be nobody's rather than shared.
        Assert.Equal(
            0,
            Scalar("""
                SELECT COUNT(*)
                FROM sys.columns AS c
                JOIN sys.tables AS t ON t.object_id = c.object_id
                JOIN sys.schemas AS s ON s.schema_id = t.schema_id
                WHERE s.name = N'folio' AND c.name = N'UserId' AND c.is_nullable = 1
                """));

        // Every folio table has its foreign key, so a row cannot outlive its account.
        Assert.Equal(
            17,
            Scalar("SELECT COUNT(*) FROM sys.foreign_keys WHERE [name] LIKE N'FK[_]%[_]AuthUsers'"));

        // The two keys inside the schema carry the owner as well, or a goal from one
        // account could be pointed at by a contribution from another.
        Assert.Equal(
            3,
            Scalar("""
                SELECT COUNT(*)
                FROM sys.foreign_key_columns AS fkc
                WHERE fkc.constraint_object_id = OBJECT_ID(N'[folio].[FK_SavingsContributions_SavingsGoals]')
                """));

        // Running it again is what a deploy does on the next push, and it has to be a no-op.
        TestDatabase.ApplyMigrations(ConnectionString);
        Assert.Equal(1, Scalar("SELECT COUNT(*) FROM [auth].[Users]"));
        Assert.Equal(3, Scalar("SELECT COUNT(*) FROM [folio].[Transactions]"));
    }

    [DatabaseFact]
    public async Task Claiming_the_first_account_takes_up_the_row_that_already_owns_the_budget()
    {
        CreateAccountlessDatabaseWithSomebodyBudgetInIt();

        TestDatabase.ApplyMigrations(ConnectionString);

        var owner = (int)Scalar("SELECT TOP (1) [Id] FROM [auth].[Users]");

        await using var db = new FolioDbContext(
            new DbContextOptionsBuilder<FolioDbContext>().UseSqlServer(ConnectionString).Options);

        var accounts = new AccountService(db, TimeProvider.System);
        var claimed = await accounts.FirstAccountAsync("wayne", "waynes-own-password", CancellationToken.None);

        // The account that takes up the placeholder is the account the budget already
        // belongs to, so nothing had to move between owners.
        Assert.Equal(owner, claimed.Id);
        Assert.Equal("wayne", claimed.Username);
        Assert.True(claimed.IsClaimed);

        Assert.Equal(
            3,
            Scalar($"SELECT COUNT(*) FROM [folio].[Transactions] WHERE [UserId] = {owner}"));
    }

    /// <summary>
    /// The tables as this project shipped them, with a budget in them and no accounts
    /// anywhere. Every one of the seventeen is here, because the migration touches every one.
    /// </summary>
    private void CreateAccountlessDatabaseWithSomebodyBudgetInIt()
    {
        TestDatabase.CreateEmpty(TestDatabase.Server, _database);

        TestDatabase.RunScript(ConnectionString, """
CREATE SCHEMA [folio] AUTHORIZATION [dbo];
GO

-- The preferences. One row, enforced by the check: there is one person using this budget,
-- so a table of settings for different people would only hold one.
--
-- The country it names is a column, and it selects which rows of the other tables the site
-- reads.
CREATE TABLE [folio].[Settings]
(
    [Id]                 TINYINT      NOT NULL CONSTRAINT [DF_Settings_Id] DEFAULT (1),
    [Theme]              VARCHAR (16) NOT NULL,
    [Locale]             NVARCHAR (32) NOT NULL,
    [Currency]           CHAR (3)     NOT NULL,
    [DateStyle]          VARCHAR (8)  NOT NULL,
    [TimeStyle]          VARCHAR (4)  NOT NULL,
    [Country]            NVARCHAR (40) NULL,
    [BillableMonthStart] TINYINT      NOT NULL CONSTRAINT [DF_Settings_BillableMonthStart] DEFAULT (1),
    [BalanceCutoffTxId]  INT          NULL,
    CONSTRAINT [PK_Settings] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [CK_Settings_OneRow] CHECK ([Id] = 1),
    CONSTRAINT [CK_Settings_BillableMonthStart] CHECK ([BillableMonthStart] BETWEEN 1 AND 28)
);

-- The next id for each client-side collection.
--
-- Folio's ids are small integers the browser allocates before anything is saved, and
-- several of them are shared between tables (a budget item id appears on transactions
-- and on budget assignments). Keeping the counters here means a reload, a second browser
-- or a deploy never hands out an id that is already in use.
CREATE TABLE [folio].[Counters]
(
    [Country] NVARCHAR (40) NOT NULL,
    [Name]    VARCHAR (40) NOT NULL,
    [Value]   INT          NOT NULL,
    CONSTRAINT [PK_Counters] PRIMARY KEY CLUSTERED ([Country], [Name])
);

-- The accounts money moves between: everyday accounts, savings accounts and
-- liabilities. The id is a string the site allocates ("acc-12"), because transactions
-- and savings goals both refer to it.
CREATE TABLE [folio].[Accounts]
(
    [Country]           NVARCHAR (40)  NOT NULL,
    [Id]                NVARCHAR (32)  NOT NULL,
    [Name]              NVARCHAR (100) NOT NULL,
    [Type]              VARCHAR (16)   NULL,
    [ExcludeFromBudget] BIT            NULL,
    [Archived]          BIT            NULL,
    [BankId]            NVARCHAR (32)  NULL,
    [SortOrder]         INT            NOT NULL,
    CONSTRAINT [PK_Accounts] PRIMARY KEY CLUSTERED ([Country], [Id])
);
GO

CREATE NONCLUSTERED INDEX [IX_Accounts_Country_Name]
    ON [folio].[Accounts] ([Country], [Name]);

-- Every transaction in the log. Amounts are always positive; [Type] says which way the
-- money went, which is what lets a refund reduce a budget item rather than being stored
-- as a negative amount.
CREATE TABLE [folio].[Transactions]
(
    [Country]   NVARCHAR (40)  NOT NULL,
    [Id]        INT            NOT NULL,
    [Name]      NVARCHAR (200) NOT NULL,
    [Date]      DATE           NOT NULL,
    [CreatedAt] DATETIME2 (3)  NOT NULL,
    [Amount]    DECIMAL (18, 4) NOT NULL,
    [Type]      VARCHAR (3)    NOT NULL,
    [ItemId]    INT            NULL,
    [AccountId] NVARCHAR (32)  NULL,
    [Notes]     NVARCHAR (1000) NULL,
    [Flagged]   BIT            NULL,
    [Locked]    BIT            NULL,
    [Recurring] BIT            NULL,
    [SortOrder] INT            NOT NULL,
    CONSTRAINT [PK_Transactions] PRIMARY KEY CLUSTERED ([Country], [Id]),
    CONSTRAINT [CK_Transactions_Type] CHECK ([Type] IN ('in', 'out'))
);
GO

-- The log is read a month at a time and filtered by account, which is what these cover.
CREATE NONCLUSTERED INDEX [IX_Transactions_Country_Date]
    ON [folio].[Transactions] ([Country], [Date] DESC);
GO

CREATE NONCLUSTERED INDEX [IX_Transactions_Country_AccountId]
    ON [folio].[Transactions] ([Country], [AccountId]);

-- Planned money that has not happened yet. [Done] marks one that has, and
-- [LinkedTransactionId] points at the transaction it became.
CREATE TABLE [folio].[UpcomingTransactions]
(
    [Country]             NVARCHAR (40)  NOT NULL,
    [Id]                  INT            NOT NULL,
    [Title]               NVARCHAR (200) NOT NULL,
    [Amount]              DECIMAL (18, 4) NOT NULL,
    [Type]                VARCHAR (3)    NOT NULL,
    [Date]                DATE           NOT NULL,
    [Notes]               NVARCHAR (1000) NULL,
    [Done]                BIT            NOT NULL,
    [LinkedTransactionId] INT            NULL,
    [CreatedAt]           DATETIME2 (3)  NOT NULL,
    [Recurring]           VARCHAR (8)    NULL,
    [SortOrder]           INT            NOT NULL,
    CONSTRAINT [PK_UpcomingTransactions] PRIMARY KEY CLUSTERED ([Country], [Id]),
    CONSTRAINT [CK_UpcomingTransactions_Type] CHECK ([Type] IN ('in', 'out')),
    CONSTRAINT [CK_UpcomingTransactions_Recurring] CHECK ([Recurring] IS NULL OR [Recurring] IN ('weekly', 'monthly', 'yearly'))
);

-- The budget's categories, defined once and shared by every month and by the template.
-- A transaction points at one of these through [ItemId]; the name is global, the money
-- assigned to it is per month (BudgetAssignments).
CREATE TABLE [folio].[BudgetItems]
(
    [Country]   NVARCHAR (40)  NOT NULL,
    [Id]        INT            NOT NULL,
    [Name]      NVARCHAR (100) NOT NULL,
    [SortOrder] INT            NOT NULL,
    CONSTRAINT [PK_BudgetItems] PRIMARY KEY CLUSTERED ([Country], [Id])
);

-- How much was assigned to each budget item in a given month. A month with no rows has
-- nothing assigned, which is different from assigning zero only in that it has never been
-- touched.
CREATE TABLE [folio].[BudgetAssignments]
(
    [Country]  NVARCHAR (40)  NOT NULL,
    [Year]     SMALLINT       NOT NULL,
    [Month]    TINYINT        NOT NULL,
    [ItemId]   INT            NOT NULL,
    [Assigned] DECIMAL (18, 4) NOT NULL,
    [Category] NVARCHAR (100) NOT NULL,
    CONSTRAINT [PK_BudgetAssignments] PRIMARY KEY CLUSTERED ([Country], [Year], [Month], [ItemId]),
    CONSTRAINT [CK_BudgetAssignments_Month] CHECK ([Month] BETWEEN 1 AND 12)
);

-- The standing budget every new month starts from: which items it has, what they are
-- assigned, and the category each is filed under. [SortOrder] is the order the user put
-- them in, which the template page shows as it is.
CREATE TABLE [folio].[BudgetTemplateEntries]
(
    [Country]   NVARCHAR (40)  NOT NULL,
    [ItemId]    INT            NOT NULL,
    [Assigned]  DECIMAL (18, 4) NOT NULL,
    [Category]  NVARCHAR (100) NOT NULL,
    [SortOrder] INT            NOT NULL,
    CONSTRAINT [PK_BudgetTemplateEntries] PRIMARY KEY CLUSTERED ([Country], [ItemId])
);

-- A savings goal, and the account it is watched through when it has one.
--
-- The contributions are a table of their own (SavingsContributions): a goal's progress is
-- the sum of them, and a list inside a column could not be summed or reported on.
CREATE TABLE [folio].[SavingsGoals]
(
    [Country]         NVARCHAR (40)  NOT NULL,
    [Id]              INT            NOT NULL,
    [Name]            NVARCHAR (100) NOT NULL,
    [TargetAmount]    DECIMAL (18, 4) NOT NULL,
    [Deadline]        DATE           NULL,
    [Color]           NVARCHAR (32)  NOT NULL,
    [LinkedAccountId] NVARCHAR (32)  NULL,
    [CreatedAt]       DATETIME2 (3)  NOT NULL,
    [Archived]        BIT            NOT NULL,
    [SortOrder]       INT            NOT NULL,
    CONSTRAINT [PK_SavingsGoals] PRIMARY KEY CLUSTERED ([Country], [Id])
);

-- Money put towards a savings goal.
CREATE TABLE [folio].[SavingsContributions]
(
    [Country]   NVARCHAR (40)  NOT NULL,
    [Id]        INT            NOT NULL,
    [GoalId]    INT            NOT NULL,
    [Date]      DATE           NOT NULL,
    [Amount]    DECIMAL (18, 4) NOT NULL,
    [Note]      NVARCHAR (500) NULL,
    [SortOrder] INT            NOT NULL,
    CONSTRAINT [PK_SavingsContributions] PRIMARY KEY CLUSTERED ([Country], [Id]),
    CONSTRAINT [FK_SavingsContributions_SavingsGoals] FOREIGN KEY ([Country], [GoalId])
        REFERENCES [folio].[SavingsGoals] ([Country], [Id])
);
GO

CREATE NONCLUSTERED INDEX [IX_SavingsContributions_Goal]
    ON [folio].[SavingsContributions] ([Country], [GoalId]);

-- A loan being paid off. The amortisation schedule is worked out from these figures
-- rather than stored: it is a projection, and a stored one would go stale the moment an
-- extra payment was made.
CREATE TABLE [folio].[Loans]
(
    [Country]         NVARCHAR (40)  NOT NULL,
    [Id]              INT            NOT NULL,
    [Name]            NVARCHAR (100) NOT NULL,
    [Principal]       DECIMAL (18, 4) NOT NULL,
    [Apr]             DECIMAL (9, 6) NOT NULL,
    [TermMonths]      INT            NOT NULL,
    [StartDate]       DATE           NOT NULL,
    [LinkedAccountId] NVARCHAR (32)  NULL,
    [Color]           NVARCHAR (32)  NOT NULL,
    [CreatedAt]       DATETIME2 (3)  NOT NULL,
    [Archived]        BIT            NOT NULL,
    [SortOrder]       INT            NOT NULL,
    CONSTRAINT [PK_Loans] PRIMARY KEY CLUSTERED ([Country], [Id])
);

-- A savings account being tracked for its interest, as a loan is tracked for its
-- repayments. Named SavingsRecords rather than SavingsAccounts so it does not read as one
-- of the user's Accounts.
CREATE TABLE [folio].[SavingsRecords]
(
    [Country]         NVARCHAR (40)  NOT NULL,
    [Id]              INT            NOT NULL,
    [Name]            NVARCHAR (100) NOT NULL,
    [Apr]             DECIMAL (9, 6) NOT NULL,
    [CompoundFreq]    VARCHAR (12)   NOT NULL,
    [StartBalance]    DECIMAL (18, 4) NOT NULL,
    [StartDate]       DATE           NOT NULL,
    [LinkedAccountId] NVARCHAR (32)  NULL,
    [Color]           NVARCHAR (32)  NOT NULL,
    [CreatedAt]       DATETIME2 (3)  NOT NULL,
    [Archived]        BIT            NOT NULL,
    [SortOrder]       INT            NOT NULL,
    CONSTRAINT [PK_SavingsRecords] PRIMARY KEY CLUSTERED ([Country], [Id]),
    CONSTRAINT [CK_SavingsRecords_CompoundFreq] CHECK ([CompoundFreq] IN ('monthly', 'quarterly', 'annually'))
);

-- The quick calculator's own state: the income it starts from, and which saved
-- simulation the user marked as the ideal. The commitments are PlannerItems, and the
-- what-if scenarios are PlannerSimulations. One row per country.
CREATE TABLE [folio].[PlannerState]
(
    [Country]           NVARCHAR (40)  NOT NULL,
    [Income]            DECIMAL (18, 4) NOT NULL,
    [IdealSimulationId] INT            NULL,
    CONSTRAINT [PK_PlannerState] PRIMARY KEY CLUSTERED ([Country])
);

-- The standing commitments the quick calculator deducts from income.
CREATE TABLE [folio].[PlannerItems]
(
    [Country]   NVARCHAR (40)  NOT NULL,
    [Id]        INT            NOT NULL,
    [Name]      NVARCHAR (100) NOT NULL,
    [Amount]    DECIMAL (18, 4) NOT NULL,
    [SortOrder] INT            NOT NULL,
    CONSTRAINT [PK_PlannerItems] PRIMARY KEY CLUSTERED ([Country], [Id])
);

-- A saved what-if scenario, for one month ("2025-03").
CREATE TABLE [folio].[PlannerSimulations]
(
    [Country]   NVARCHAR (40)  NOT NULL,
    [Id]        INT            NOT NULL,
    [Name]      NVARCHAR (100) NOT NULL,
    [Month]     CHAR (7)       NOT NULL,
    [SortOrder] INT            NOT NULL,
    CONSTRAINT [PK_PlannerSimulations] PRIMARY KEY CLUSTERED ([Country], [Id])
);

-- A line in a saved scenario. [Source] records where the figure came from -- a real
-- transaction, a standing commitment, or one typed into the scenario -- so the scenario
-- still means something once the transaction behind it changes.
CREATE TABLE [folio].[PlannerSimulationItems]
(
    [Country]       NVARCHAR (40)  NOT NULL,
    [Id]            INT            NOT NULL,
    [SimulationId]  INT            NOT NULL,
    [Name]          NVARCHAR (100) NOT NULL,
    [Amount]        DECIMAL (18, 4) NOT NULL,
    [Kind]          VARCHAR (8)    NOT NULL,
    [Source]        VARCHAR (16)   NOT NULL,
    [TransactionId] INT            NULL,
    [PlannerItemId] INT            NULL,
    [SortOrder]     INT            NOT NULL,
    CONSTRAINT [PK_PlannerSimulationItems] PRIMARY KEY CLUSTERED ([Country], [Id]),
    CONSTRAINT [FK_PlannerSimulationItems_PlannerSimulations] FOREIGN KEY ([Country], [SimulationId])
        REFERENCES [folio].[PlannerSimulations] ([Country], [Id]),
    CONSTRAINT [CK_PlannerSimulationItems_Kind] CHECK ([Kind] IN ('income', 'expense')),
    CONSTRAINT [CK_PlannerSimulationItems_Source] CHECK ([Source] IN ('transaction', 'planner', 'custom'))
);
GO

CREATE NONCLUSTERED INDEX [IX_PlannerSimulationItems_Simulation]
    ON [folio].[PlannerSimulationItems] ([Country], [SimulationId]);

-- What each bank import brought in, so the transactions page can say where a row came
-- from and the user can see what they have already imported.
CREATE TABLE [folio].[ImportHistory]
(
    [Country]   NVARCHAR (40)  NOT NULL,
    [Id]        INT            NOT NULL,
    [Date]      DATETIME2 (3)  NOT NULL,
    [BankName]  NVARCHAR (100) NOT NULL,
    [AdapterId] NVARCHAR (32)  NOT NULL,
    [FileName]  NVARCHAR (260) NOT NULL,
    [RowCount]  INT            NOT NULL,
    [SortOrder] INT            NOT NULL,
    CONSTRAINT [PK_ImportHistory] PRIMARY KEY CLUSTERED ([Country], [Id])
);

""");

        TestDatabase.RunScript(ConnectionString, """
            INSERT INTO [folio].[Settings] ([Theme], [Locale], [Currency], [DateStyle], [TimeStyle], [Country], [BillableMonthStart])
            VALUES ('midnight', 'en-IE', 'EUR', 'medium', '24h', 'ireland', 1);

            INSERT INTO [folio].[Accounts] ([Country], [Id], [Name], [Type], [SortOrder])
            VALUES ('ireland', 'acc-1', 'Current account', 'checking', 0),
                   ('ireland', 'acc-2', 'Savings', 'savings', 1);

            INSERT INTO [folio].[Transactions] ([Country], [Id], [Name], [Date], [CreatedAt], [Amount], [Type], [SortOrder])
            VALUES ('ireland', 1, 'Groceries', '2026-02-01', '2026-02-01T10:00:00', 42.35, 'out', 0),
                   ('ireland', 2, 'Salary', '2026-02-01', '2026-02-01T08:00:00', 3200.00, 'in', 1),
                   ('ireland', 3, 'Rent', '2026-02-02', '2026-02-02T08:00:00', 1200.00, 'out', 2);

            INSERT INTO [folio].[BudgetAssignments] ([Country], [Year], [Month], [ItemId], [Assigned], [Category])
            VALUES ('ireland', 2026, 2, 1, 400.00, 'Groceries'),
                   ('ireland', 2026, 2, 2, 1200.00, 'Housing');

            INSERT INTO [folio].[Counters] ([Country], [Name], [Value])
            VALUES ('ireland', 'transactions', 4),
                   ('ireland', 'accounts', 3);

            INSERT INTO [folio].[SavingsGoals] ([Country], [Id], [Name], [TargetAmount], [Color], [CreatedAt], [Archived], [SortOrder])
            VALUES ('ireland', 1, 'Holiday', 2000.00, '#123456', '2026-01-01T00:00:00', 0, 0);

            INSERT INTO [folio].[SavingsContributions] ([Country], [Id], [GoalId], [Date], [Amount], [SortOrder])
            VALUES ('ireland', 1, 1, '2026-01-15', 250.00, 0),
                   ('ireland', 2, 1, '2026-02-15', 250.00, 1);

            INSERT INTO [folio].[PlannerState] ([Country], [Income])
            VALUES ('ireland', 3200.00);

            INSERT INTO [folio].[PlannerSimulations] ([Country], [Id], [Name], [Month], [SortOrder])
            VALUES ('ireland', 1, 'What if', '2026-03', 0);

            INSERT INTO [folio].[PlannerSimulationItems] ([Country], [Id], [SimulationId], [Name], [Amount], [Kind], [Source], [SortOrder])
            VALUES ('ireland', 1, 1, 'Rent', 1200.00, 'expense', 'custom', 0);
            """);
    }

    private object Scalar(string sql)
    {
        using var connection = new SqlConnection(ConnectionString);
        connection.Open();

        using var command = connection.CreateCommand();
        command.CommandText = sql;

        return command.ExecuteScalar()!;
    }

    public void Dispose() => TestDatabase.Drop(TestDatabase.Server, _database);
}
