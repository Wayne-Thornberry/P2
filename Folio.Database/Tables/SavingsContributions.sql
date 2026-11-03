-- Money put towards a savings goal. Deleting the goal takes its contributions with it,
-- which is the one place a cascade is the behaviour the app wants.
CREATE TABLE [folio].[SavingsContributions]
(
    [UserId]  INT            NOT NULL,
    [Country] NVARCHAR (40)  NOT NULL,
    [Id]      INT            NOT NULL,
    [GoalId]  INT            NOT NULL,
    [Date]    DATE           NOT NULL,
    [Amount]  DECIMAL (18, 4) NOT NULL,
    [Note]    NVARCHAR (500) NULL,
    [SortOrder] INT          NOT NULL,
    CONSTRAINT [PK_SavingsContributions] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]),
    CONSTRAINT [FK_SavingsContributions_Users] FOREIGN KEY ([UserId]) REFERENCES [core].[Users] ([Id]) ON DELETE CASCADE,
    -- No cascade from the goal: the user cascade already reaches these rows, and two
    -- cascade paths to one table is a cycle SQL Server refuses. The API deletes the
    -- contributions before the goals, which is the same outcome, said once.
    CONSTRAINT [FK_SavingsContributions_SavingsGoals] FOREIGN KEY ([UserId], [Country], [GoalId])
        REFERENCES [folio].[SavingsGoals] ([UserId], [Country], [Id])
);
GO

CREATE NONCLUSTERED INDEX [IX_SavingsContributions_Goal]
    ON [folio].[SavingsContributions] ([UserId], [Country], [GoalId]);
