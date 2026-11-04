-- Money put towards a savings goal.
CREATE TABLE [folio].[SavingsContributions]
(
    [UserId]    INT            NOT NULL,
    [Country]   NVARCHAR (40)  NOT NULL,
    [Id]        INT            NOT NULL,
    [GoalId]    INT            NOT NULL,
    [Date]      DATE           NOT NULL,
    [Amount]    DECIMAL (18, 4) NOT NULL,
    [Note]      NVARCHAR (500) NULL,
    [SortOrder] INT            NOT NULL,
    CONSTRAINT [PK_SavingsContributions] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]),
    CONSTRAINT [FK_SavingsContributions_SavingsGoals] FOREIGN KEY ([UserId], [Country], [GoalId])
        REFERENCES [folio].[SavingsGoals] ([UserId], [Country], [Id]),
    CONSTRAINT [FK_SavingsContributions_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id])
);
GO

CREATE NONCLUSTERED INDEX [IX_SavingsContributions_Goal]
    ON [folio].[SavingsContributions] ([UserId], [Country], [GoalId]);