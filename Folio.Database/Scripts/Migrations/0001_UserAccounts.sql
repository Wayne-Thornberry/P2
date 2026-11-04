-- Accounts, and the ownership the folio tables never had.
--
-- A database that has been deployed carries one person's budget and no user at all. This
-- brings it to the shape the model describes without losing a row:
--
--   1. the auth schema and its two tables, as the model has them;
--   2. a placeholder account, which owns everything that was saved before there was
--      anybody to own it. It cannot sign in -- nothing is set but its name -- and claiming
--      the first account is filling that row in rather than moving data between owners;
--   3. a UserId on each folio table, backfilled to the placeholder, then made NOT NULL
--      with its foreign key, and every primary key, foreign key and index widened to
--      begin with it;
--   4. Settings loses its constant Id, which is what kept it to one row: the account is
--      what there is now one of these for.
--
-- Idempotent, as every migration is: a database built from the model already has all of
-- this, every block below finds nothing to do, and it is left alone.
--
-- The placeholder's name is not one a person can type (the API's names are letters,
-- digits, dots, dashes and underscores), so it cannot collide with a real account and it
-- cannot be signed in as.

IF SCHEMA_ID(N'auth') IS NULL
    EXEC (N'CREATE SCHEMA [auth] AUTHORIZATION [dbo];');
GO

IF OBJECT_ID(N'[auth].[Users]', N'U') IS NULL
    CREATE TABLE [auth].[Users]
    (
        [Id]                 INT            IDENTITY (1, 1) NOT NULL,
        [Username]           NVARCHAR (32)  NOT NULL,
        [PasswordHash]       VARBINARY (32) NOT NULL,
        [PasswordSalt]       VARBINARY (16) NOT NULL,
        [MustChangePassword] BIT            NOT NULL CONSTRAINT [DF_Users_MustChangePassword] DEFAULT (1),
        [PinHash]            VARBINARY (32) NULL,
        [PinSalt]            VARBINARY (16) NULL,
        [PinFailedCount]     INT            NOT NULL CONSTRAINT [DF_Users_PinFailedCount] DEFAULT (0),
        [PinLockedUntil]     DATETIME2 (3)  NULL,
        [ClaimedAt]          DATETIME2 (3)  NULL,
        [CreatedAt]          DATETIME2 (3)  NOT NULL CONSTRAINT [DF_Users_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [PasswordChangedAt]  DATETIME2 (3)  NULL,
        [LastSignInAt]       DATETIME2 (3)  NULL,
        CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED ([Id]),
        CONSTRAINT [UQ_Users_Username] UNIQUE ([Username]),
        CONSTRAINT [CK_Users_Username] CHECK (LEN([Username]) >= 3),
        CONSTRAINT [CK_Users_Pin] CHECK (([PinHash] IS NULL AND [PinSalt] IS NULL) OR ([PinHash] IS NOT NULL AND [PinSalt] IS NOT NULL)),
        CONSTRAINT [CK_Users_PinFailedCount] CHECK ([PinFailedCount] >= 0)
    );
GO

IF OBJECT_ID(N'[auth].[Sessions]', N'U') IS NULL
    CREATE TABLE [auth].[Sessions]
    (
        [Id]         INT           IDENTITY (1, 1) NOT NULL,
        [UserId]     INT           NOT NULL,
        [TokenHash]  BINARY (32)   NOT NULL,
        [CreatedAt]  DATETIME2 (3) NOT NULL CONSTRAINT [DF_Sessions_CreatedAt] DEFAULT (SYSUTCDATETIME()),
        [ExpiresAt]  DATETIME2 (3) NOT NULL,
        [LastSeenAt] DATETIME2 (3) NOT NULL CONSTRAINT [DF_Sessions_LastSeenAt] DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT [PK_Sessions] PRIMARY KEY CLUSTERED ([Id]),
        CONSTRAINT [UQ_Sessions_TokenHash] UNIQUE ([TokenHash]),
        CONSTRAINT [FK_Sessions_Users] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [CK_Sessions_Expiry] CHECK ([ExpiresAt] > [CreatedAt])
    );
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_Sessions_ExpiresAt' AND [object_id] = OBJECT_ID(N'[auth].[Sessions]'))
    CREATE NONCLUSTERED INDEX [IX_Sessions_ExpiresAt] ON [auth].[Sessions] ([ExpiresAt]);
GO
-- The placeholder: one row that owns everything saved before there were accounts. Its
-- password hash is a value no password produces (32 zero bytes over a zero salt), so it
-- cannot be signed in as even by guessing, and ClaimedAt stays null until the first
-- account fills it in. Only made when there is something for it to own.
DECLARE @owner INT =
    (SELECT TOP (1) [Id] FROM [auth].[Users] WHERE [ClaimedAt] IS NULL ORDER BY [Id]);

IF @owner IS NULL
   AND (EXISTS (SELECT 1 FROM [folio].[Accounts]) OR EXISTS (SELECT 1 FROM [folio].[BudgetAssignments]) OR EXISTS (SELECT 1 FROM [folio].[BudgetItems]) OR EXISTS (SELECT 1 FROM [folio].[BudgetTemplateEntries]) OR EXISTS (SELECT 1 FROM [folio].[Counters]) OR EXISTS (SELECT 1 FROM [folio].[ImportHistory]) OR EXISTS (SELECT 1 FROM [folio].[Loans]) OR EXISTS (SELECT 1 FROM [folio].[PlannerItems]) OR EXISTS (SELECT 1 FROM [folio].[PlannerSimulationItems]) OR EXISTS (SELECT 1 FROM [folio].[PlannerSimulations]) OR EXISTS (SELECT 1 FROM [folio].[PlannerState]) OR EXISTS (SELECT 1 FROM [folio].[SavingsContributions]) OR EXISTS (SELECT 1 FROM [folio].[SavingsGoals]) OR EXISTS (SELECT 1 FROM [folio].[SavingsRecords]) OR EXISTS (SELECT 1 FROM [folio].[Transactions]) OR EXISTS (SELECT 1 FROM [folio].[UpcomingTransactions]) OR EXISTS (SELECT 1 FROM [folio].[Settings]))
BEGIN
    INSERT INTO [auth].[Users] ([Username], [PasswordHash], [PasswordSalt])
    VALUES (N'(unclaimed)', CAST(REPLICATE(0x00, 32) AS VARBINARY (32)), CAST(REPLICATE(0x00, 16) AS VARBINARY (16)));

    SET @owner = SCOPE_IDENTITY();
END
GO

-- Dropped before the key it points at is widened, and put back at the end.
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_PlannerSimulationItems_PlannerSimulations')
    ALTER TABLE [folio].[PlannerSimulationItems] DROP CONSTRAINT [FK_PlannerSimulationItems_PlannerSimulations];
GO
-- Dropped before the key it points at is widened, and put back at the end.
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_SavingsContributions_SavingsGoals')
    ALTER TABLE [folio].[SavingsContributions] DROP CONSTRAINT [FK_SavingsContributions_SavingsGoals];
GO
-- Accounts: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[Accounts]', N'UserId') IS NULL
    ALTER TABLE [folio].[Accounts] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[Accounts] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptAccounts INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[Accounts] SET [UserId] = @adoptAccounts WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[Accounts]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[Accounts] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_Accounts' AND [parent_object_id] = OBJECT_ID(N'[folio].[Accounts]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[Accounts]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[Accounts]'), N'PK_Accounts', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[Accounts]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[Accounts] DROP CONSTRAINT [PK_Accounts];
    ALTER TABLE [folio].[Accounts] ADD CONSTRAINT [PK_Accounts] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_Accounts_AuthUsers')
    ALTER TABLE [folio].[Accounts] ADD CONSTRAINT [FK_Accounts_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
IF EXISTS (
       SELECT 1
       FROM sys.indexes AS [i]
       JOIN sys.index_columns AS [ic] ON [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id]
       JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id]
       WHERE [i].[name] = N'IX_Accounts_Country_Name'
         AND [i].[object_id] = OBJECT_ID(N'[folio].[Accounts]')
         AND [ic].[key_ordinal] = 1
         AND [c].[name] <> N'UserId')
    DROP INDEX [IX_Accounts_Country_Name] ON [folio].[Accounts];
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_Accounts_Country_Name' AND [object_id] = OBJECT_ID(N'[folio].[Accounts]'))
    CREATE NONCLUSTERED INDEX [IX_Accounts_Country_Name] ON [folio].[Accounts] ([UserId], [Country], [Name]);
GO
-- BudgetAssignments: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[BudgetAssignments]', N'UserId') IS NULL
    ALTER TABLE [folio].[BudgetAssignments] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[BudgetAssignments] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptBudgetAssignments INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[BudgetAssignments] SET [UserId] = @adoptBudgetAssignments WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[BudgetAssignments]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[BudgetAssignments] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_BudgetAssignments' AND [parent_object_id] = OBJECT_ID(N'[folio].[BudgetAssignments]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[BudgetAssignments]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[BudgetAssignments]'), N'PK_BudgetAssignments', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[BudgetAssignments]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[BudgetAssignments] DROP CONSTRAINT [PK_BudgetAssignments];
    ALTER TABLE [folio].[BudgetAssignments] ADD CONSTRAINT [PK_BudgetAssignments] PRIMARY KEY CLUSTERED ([UserId], [Country], [Year], [Month], [ItemId]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_BudgetAssignments_AuthUsers')
    ALTER TABLE [folio].[BudgetAssignments] ADD CONSTRAINT [FK_BudgetAssignments_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- BudgetItems: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[BudgetItems]', N'UserId') IS NULL
    ALTER TABLE [folio].[BudgetItems] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[BudgetItems] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptBudgetItems INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[BudgetItems] SET [UserId] = @adoptBudgetItems WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[BudgetItems]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[BudgetItems] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_BudgetItems' AND [parent_object_id] = OBJECT_ID(N'[folio].[BudgetItems]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[BudgetItems]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[BudgetItems]'), N'PK_BudgetItems', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[BudgetItems]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[BudgetItems] DROP CONSTRAINT [PK_BudgetItems];
    ALTER TABLE [folio].[BudgetItems] ADD CONSTRAINT [PK_BudgetItems] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_BudgetItems_AuthUsers')
    ALTER TABLE [folio].[BudgetItems] ADD CONSTRAINT [FK_BudgetItems_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- BudgetTemplateEntries: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[BudgetTemplateEntries]', N'UserId') IS NULL
    ALTER TABLE [folio].[BudgetTemplateEntries] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[BudgetTemplateEntries] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptBudgetTemplateEntries INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[BudgetTemplateEntries] SET [UserId] = @adoptBudgetTemplateEntries WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[BudgetTemplateEntries]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[BudgetTemplateEntries] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_BudgetTemplateEntries' AND [parent_object_id] = OBJECT_ID(N'[folio].[BudgetTemplateEntries]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[BudgetTemplateEntries]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[BudgetTemplateEntries]'), N'PK_BudgetTemplateEntries', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[BudgetTemplateEntries]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[BudgetTemplateEntries] DROP CONSTRAINT [PK_BudgetTemplateEntries];
    ALTER TABLE [folio].[BudgetTemplateEntries] ADD CONSTRAINT [PK_BudgetTemplateEntries] PRIMARY KEY CLUSTERED ([UserId], [Country], [ItemId]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_BudgetTemplateEntries_AuthUsers')
    ALTER TABLE [folio].[BudgetTemplateEntries] ADD CONSTRAINT [FK_BudgetTemplateEntries_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- Counters: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[Counters]', N'UserId') IS NULL
    ALTER TABLE [folio].[Counters] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[Counters] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptCounters INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[Counters] SET [UserId] = @adoptCounters WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[Counters]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[Counters] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_Counters' AND [parent_object_id] = OBJECT_ID(N'[folio].[Counters]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[Counters]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[Counters]'), N'PK_Counters', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[Counters]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[Counters] DROP CONSTRAINT [PK_Counters];
    ALTER TABLE [folio].[Counters] ADD CONSTRAINT [PK_Counters] PRIMARY KEY CLUSTERED ([UserId], [Country], [Name]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_Counters_AuthUsers')
    ALTER TABLE [folio].[Counters] ADD CONSTRAINT [FK_Counters_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- ImportHistory: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[ImportHistory]', N'UserId') IS NULL
    ALTER TABLE [folio].[ImportHistory] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[ImportHistory] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptImportHistory INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[ImportHistory] SET [UserId] = @adoptImportHistory WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[ImportHistory]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[ImportHistory] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_ImportHistory' AND [parent_object_id] = OBJECT_ID(N'[folio].[ImportHistory]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[ImportHistory]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[ImportHistory]'), N'PK_ImportHistory', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[ImportHistory]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[ImportHistory] DROP CONSTRAINT [PK_ImportHistory];
    ALTER TABLE [folio].[ImportHistory] ADD CONSTRAINT [PK_ImportHistory] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_ImportHistory_AuthUsers')
    ALTER TABLE [folio].[ImportHistory] ADD CONSTRAINT [FK_ImportHistory_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- Loans: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[Loans]', N'UserId') IS NULL
    ALTER TABLE [folio].[Loans] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[Loans] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptLoans INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[Loans] SET [UserId] = @adoptLoans WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[Loans]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[Loans] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_Loans' AND [parent_object_id] = OBJECT_ID(N'[folio].[Loans]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[Loans]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[Loans]'), N'PK_Loans', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[Loans]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[Loans] DROP CONSTRAINT [PK_Loans];
    ALTER TABLE [folio].[Loans] ADD CONSTRAINT [PK_Loans] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_Loans_AuthUsers')
    ALTER TABLE [folio].[Loans] ADD CONSTRAINT [FK_Loans_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- PlannerItems: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[PlannerItems]', N'UserId') IS NULL
    ALTER TABLE [folio].[PlannerItems] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[PlannerItems] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptPlannerItems INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[PlannerItems] SET [UserId] = @adoptPlannerItems WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[PlannerItems]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[PlannerItems] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_PlannerItems' AND [parent_object_id] = OBJECT_ID(N'[folio].[PlannerItems]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[PlannerItems]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[PlannerItems]'), N'PK_PlannerItems', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[PlannerItems]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[PlannerItems] DROP CONSTRAINT [PK_PlannerItems];
    ALTER TABLE [folio].[PlannerItems] ADD CONSTRAINT [PK_PlannerItems] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_PlannerItems_AuthUsers')
    ALTER TABLE [folio].[PlannerItems] ADD CONSTRAINT [FK_PlannerItems_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- PlannerSimulationItems: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[PlannerSimulationItems]', N'UserId') IS NULL
    ALTER TABLE [folio].[PlannerSimulationItems] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[PlannerSimulationItems] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptPlannerSimulationItems INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[PlannerSimulationItems] SET [UserId] = @adoptPlannerSimulationItems WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[PlannerSimulationItems]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[PlannerSimulationItems] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_PlannerSimulationItems' AND [parent_object_id] = OBJECT_ID(N'[folio].[PlannerSimulationItems]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[PlannerSimulationItems]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[PlannerSimulationItems]'), N'PK_PlannerSimulationItems', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[PlannerSimulationItems]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[PlannerSimulationItems] DROP CONSTRAINT [PK_PlannerSimulationItems];
    ALTER TABLE [folio].[PlannerSimulationItems] ADD CONSTRAINT [PK_PlannerSimulationItems] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_PlannerSimulationItems_AuthUsers')
    ALTER TABLE [folio].[PlannerSimulationItems] ADD CONSTRAINT [FK_PlannerSimulationItems_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
IF EXISTS (
       SELECT 1
       FROM sys.indexes AS [i]
       JOIN sys.index_columns AS [ic] ON [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id]
       JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id]
       WHERE [i].[name] = N'IX_PlannerSimulationItems_Simulation'
         AND [i].[object_id] = OBJECT_ID(N'[folio].[PlannerSimulationItems]')
         AND [ic].[key_ordinal] = 1
         AND [c].[name] <> N'UserId')
    DROP INDEX [IX_PlannerSimulationItems_Simulation] ON [folio].[PlannerSimulationItems];
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_PlannerSimulationItems_Simulation' AND [object_id] = OBJECT_ID(N'[folio].[PlannerSimulationItems]'))
    CREATE NONCLUSTERED INDEX [IX_PlannerSimulationItems_Simulation] ON [folio].[PlannerSimulationItems] ([UserId], [Country], [SimulationId]);
GO
-- PlannerSimulations: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[PlannerSimulations]', N'UserId') IS NULL
    ALTER TABLE [folio].[PlannerSimulations] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[PlannerSimulations] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptPlannerSimulations INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[PlannerSimulations] SET [UserId] = @adoptPlannerSimulations WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[PlannerSimulations]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[PlannerSimulations] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_PlannerSimulations' AND [parent_object_id] = OBJECT_ID(N'[folio].[PlannerSimulations]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[PlannerSimulations]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[PlannerSimulations]'), N'PK_PlannerSimulations', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[PlannerSimulations]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[PlannerSimulations] DROP CONSTRAINT [PK_PlannerSimulations];
    ALTER TABLE [folio].[PlannerSimulations] ADD CONSTRAINT [PK_PlannerSimulations] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_PlannerSimulations_AuthUsers')
    ALTER TABLE [folio].[PlannerSimulations] ADD CONSTRAINT [FK_PlannerSimulations_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- PlannerState: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[PlannerState]', N'UserId') IS NULL
    ALTER TABLE [folio].[PlannerState] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[PlannerState] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptPlannerState INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[PlannerState] SET [UserId] = @adoptPlannerState WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[PlannerState]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[PlannerState] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_PlannerState' AND [parent_object_id] = OBJECT_ID(N'[folio].[PlannerState]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[PlannerState]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[PlannerState]'), N'PK_PlannerState', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[PlannerState]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[PlannerState] DROP CONSTRAINT [PK_PlannerState];
    ALTER TABLE [folio].[PlannerState] ADD CONSTRAINT [PK_PlannerState] PRIMARY KEY CLUSTERED ([UserId], [Country]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_PlannerState_AuthUsers')
    ALTER TABLE [folio].[PlannerState] ADD CONSTRAINT [FK_PlannerState_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- SavingsContributions: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[SavingsContributions]', N'UserId') IS NULL
    ALTER TABLE [folio].[SavingsContributions] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[SavingsContributions] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptSavingsContributions INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[SavingsContributions] SET [UserId] = @adoptSavingsContributions WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[SavingsContributions]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[SavingsContributions] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_SavingsContributions' AND [parent_object_id] = OBJECT_ID(N'[folio].[SavingsContributions]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[SavingsContributions]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[SavingsContributions]'), N'PK_SavingsContributions', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[SavingsContributions]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[SavingsContributions] DROP CONSTRAINT [PK_SavingsContributions];
    ALTER TABLE [folio].[SavingsContributions] ADD CONSTRAINT [PK_SavingsContributions] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_SavingsContributions_AuthUsers')
    ALTER TABLE [folio].[SavingsContributions] ADD CONSTRAINT [FK_SavingsContributions_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
IF EXISTS (
       SELECT 1
       FROM sys.indexes AS [i]
       JOIN sys.index_columns AS [ic] ON [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id]
       JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id]
       WHERE [i].[name] = N'IX_SavingsContributions_Goal'
         AND [i].[object_id] = OBJECT_ID(N'[folio].[SavingsContributions]')
         AND [ic].[key_ordinal] = 1
         AND [c].[name] <> N'UserId')
    DROP INDEX [IX_SavingsContributions_Goal] ON [folio].[SavingsContributions];
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_SavingsContributions_Goal' AND [object_id] = OBJECT_ID(N'[folio].[SavingsContributions]'))
    CREATE NONCLUSTERED INDEX [IX_SavingsContributions_Goal] ON [folio].[SavingsContributions] ([UserId], [Country], [GoalId]);
GO
-- SavingsGoals: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[SavingsGoals]', N'UserId') IS NULL
    ALTER TABLE [folio].[SavingsGoals] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[SavingsGoals] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptSavingsGoals INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[SavingsGoals] SET [UserId] = @adoptSavingsGoals WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[SavingsGoals]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[SavingsGoals] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_SavingsGoals' AND [parent_object_id] = OBJECT_ID(N'[folio].[SavingsGoals]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[SavingsGoals]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[SavingsGoals]'), N'PK_SavingsGoals', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[SavingsGoals]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[SavingsGoals] DROP CONSTRAINT [PK_SavingsGoals];
    ALTER TABLE [folio].[SavingsGoals] ADD CONSTRAINT [PK_SavingsGoals] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_SavingsGoals_AuthUsers')
    ALTER TABLE [folio].[SavingsGoals] ADD CONSTRAINT [FK_SavingsGoals_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- SavingsRecords: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[SavingsRecords]', N'UserId') IS NULL
    ALTER TABLE [folio].[SavingsRecords] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[SavingsRecords] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptSavingsRecords INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[SavingsRecords] SET [UserId] = @adoptSavingsRecords WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[SavingsRecords]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[SavingsRecords] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_SavingsRecords' AND [parent_object_id] = OBJECT_ID(N'[folio].[SavingsRecords]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[SavingsRecords]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[SavingsRecords]'), N'PK_SavingsRecords', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[SavingsRecords]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[SavingsRecords] DROP CONSTRAINT [PK_SavingsRecords];
    ALTER TABLE [folio].[SavingsRecords] ADD CONSTRAINT [PK_SavingsRecords] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_SavingsRecords_AuthUsers')
    ALTER TABLE [folio].[SavingsRecords] ADD CONSTRAINT [FK_SavingsRecords_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- Transactions: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[Transactions]', N'UserId') IS NULL
    ALTER TABLE [folio].[Transactions] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[Transactions] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptTransactions INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[Transactions] SET [UserId] = @adoptTransactions WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[Transactions]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[Transactions] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_Transactions' AND [parent_object_id] = OBJECT_ID(N'[folio].[Transactions]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[Transactions]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[Transactions]'), N'PK_Transactions', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[Transactions]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[Transactions] DROP CONSTRAINT [PK_Transactions];
    ALTER TABLE [folio].[Transactions] ADD CONSTRAINT [PK_Transactions] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_Transactions_AuthUsers')
    ALTER TABLE [folio].[Transactions] ADD CONSTRAINT [FK_Transactions_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
IF EXISTS (
       SELECT 1
       FROM sys.indexes AS [i]
       JOIN sys.index_columns AS [ic] ON [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id]
       JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id]
       WHERE [i].[name] = N'IX_Transactions_Country_Date'
         AND [i].[object_id] = OBJECT_ID(N'[folio].[Transactions]')
         AND [ic].[key_ordinal] = 1
         AND [c].[name] <> N'UserId')
    DROP INDEX [IX_Transactions_Country_Date] ON [folio].[Transactions];
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_Transactions_Country_Date' AND [object_id] = OBJECT_ID(N'[folio].[Transactions]'))
    CREATE NONCLUSTERED INDEX [IX_Transactions_Country_Date] ON [folio].[Transactions] ([UserId], [Country], [Date] DESC);
GO
IF EXISTS (
       SELECT 1
       FROM sys.indexes AS [i]
       JOIN sys.index_columns AS [ic] ON [ic].[object_id] = [i].[object_id] AND [ic].[index_id] = [i].[index_id]
       JOIN sys.columns AS [c] ON [c].[object_id] = [ic].[object_id] AND [c].[column_id] = [ic].[column_id]
       WHERE [i].[name] = N'IX_Transactions_Country_AccountId'
         AND [i].[object_id] = OBJECT_ID(N'[folio].[Transactions]')
         AND [ic].[key_ordinal] = 1
         AND [c].[name] <> N'UserId')
    DROP INDEX [IX_Transactions_Country_AccountId] ON [folio].[Transactions];
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE [name] = N'IX_Transactions_Country_AccountId' AND [object_id] = OBJECT_ID(N'[folio].[Transactions]'))
    CREATE NONCLUSTERED INDEX [IX_Transactions_Country_AccountId] ON [folio].[Transactions] ([UserId], [Country], [AccountId]);
GO
-- UpcomingTransactions: the column arrives empty, is filled with the owner, and only then is made the
-- NOT NULL the model asks for.
IF COL_LENGTH(N'[folio].[UpcomingTransactions]', N'UserId') IS NULL
    ALTER TABLE [folio].[UpcomingTransactions] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[UpcomingTransactions] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptUpcomingTransactions INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[UpcomingTransactions] SET [UserId] = @adoptUpcomingTransactions WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[UpcomingTransactions]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[UpcomingTransactions] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_UpcomingTransactions' AND [parent_object_id] = OBJECT_ID(N'[folio].[UpcomingTransactions]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[UpcomingTransactions]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[UpcomingTransactions]'), N'PK_UpcomingTransactions', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[UpcomingTransactions]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[UpcomingTransactions] DROP CONSTRAINT [PK_UpcomingTransactions];
    ALTER TABLE [folio].[UpcomingTransactions] ADD CONSTRAINT [PK_UpcomingTransactions] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_UpcomingTransactions_AuthUsers')
    ALTER TABLE [folio].[UpcomingTransactions] ADD CONSTRAINT [FK_UpcomingTransactions_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- Settings: the singleton row becomes one row per person, so the key moves from the constant
-- Id to the account and the Id column goes with it.
IF COL_LENGTH(N'[folio].[Settings]', N'UserId') IS NULL
    ALTER TABLE [folio].[Settings] ADD [UserId] INT NULL;
GO

IF EXISTS (SELECT 1 FROM [folio].[Settings] WHERE [UserId] IS NULL)
BEGIN
    DECLARE @adoptSettings INT = (SELECT TOP (1) [Id] FROM [auth].[Users] ORDER BY [Id]);

    UPDATE [folio].[Settings] SET [UserId] = @adoptSettings WHERE [UserId] IS NULL;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[folio].[Settings]') AND [name] = N'UserId' AND [is_nullable] = 1)
    ALTER TABLE [folio].[Settings] ALTER COLUMN [UserId] INT NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE [name] = N'CK_Settings_OneRow' AND [parent_object_id] = OBJECT_ID(N'[folio].[Settings]'))
    ALTER TABLE [folio].[Settings] DROP CONSTRAINT [CK_Settings_OneRow];
GO

IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE [name] = N'PK_Settings' AND [parent_object_id] = OBJECT_ID(N'[folio].[Settings]'))
   AND NOT EXISTS (
       SELECT 1 FROM sys.index_columns
       WHERE [object_id] = OBJECT_ID(N'[folio].[Settings]')
         AND [index_id] = INDEXPROPERTY(OBJECT_ID(N'[folio].[Settings]'), N'PK_Settings', 'IndexId')
         AND [key_ordinal] = 1
         AND [column_id] = COLUMNPROPERTY(OBJECT_ID(N'[folio].[Settings]'), N'UserId', 'ColumnId'))
BEGIN
    ALTER TABLE [folio].[Settings] DROP CONSTRAINT [PK_Settings];

    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE [name] = N'DF_Settings_Id' AND [parent_object_id] = OBJECT_ID(N'[folio].[Settings]'))
        ALTER TABLE [folio].[Settings] DROP CONSTRAINT [DF_Settings_Id];

    IF COL_LENGTH(N'[folio].[Settings]', N'Id') IS NOT NULL
        ALTER TABLE [folio].[Settings] DROP COLUMN [Id];

    ALTER TABLE [folio].[Settings] ADD CONSTRAINT [PK_Settings] PRIMARY KEY CLUSTERED ([UserId]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_Settings_AuthUsers')
    ALTER TABLE [folio].[Settings] ADD CONSTRAINT [FK_Settings_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]);
GO
-- The two foreign keys that point at a key widened above, now carrying the owner as well.
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_SavingsContributions_SavingsGoals')
    ALTER TABLE [folio].[SavingsContributions] ADD CONSTRAINT [FK_SavingsContributions_SavingsGoals]
        FOREIGN KEY ([UserId], [Country], [GoalId]) REFERENCES [folio].[SavingsGoals] ([UserId], [Country], [Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE [name] = N'FK_PlannerSimulationItems_PlannerSimulations')
    ALTER TABLE [folio].[PlannerSimulationItems] ADD CONSTRAINT [FK_PlannerSimulationItems_PlannerSimulations]
        FOREIGN KEY ([UserId], [Country], [SimulationId]) REFERENCES [folio].[PlannerSimulations] ([UserId], [Country], [Id]);
GO
