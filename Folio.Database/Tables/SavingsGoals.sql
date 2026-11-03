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