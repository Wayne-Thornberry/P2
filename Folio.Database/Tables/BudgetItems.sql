-- The budget's categories, defined once and shared by every month and by the template.
-- A transaction points at one of these through [ItemId]; the name is global, the money
-- assigned to it is per month (BudgetAssignments).
CREATE TABLE [folio].[BudgetItems]
(
    [UserId]  INT            NOT NULL,
    [Country] NVARCHAR (40)  NOT NULL,
    [Id]      INT            NOT NULL,
    [Name]    NVARCHAR (100) NOT NULL,
    [SortOrder] INT          NOT NULL,
    CONSTRAINT [PK_BudgetItems] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]),
    CONSTRAINT [FK_BudgetItems_Users] FOREIGN KEY ([UserId]) REFERENCES [core].[Users] ([Id]) ON DELETE CASCADE
);
