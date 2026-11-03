-- How much was assigned to each budget item in a given month. A month with no rows has
-- nothing assigned, which is different from assigning zero only in that it has never been
-- touched.
CREATE TABLE [folio].[BudgetAssignments]
(
    [UserId]   INT            NOT NULL,
    [Country]  NVARCHAR (40)  NOT NULL,
    [Year]     SMALLINT       NOT NULL,
    [Month]    TINYINT        NOT NULL,
    [ItemId]   INT            NOT NULL,
    [Assigned] DECIMAL (18, 4) NOT NULL,
    [Category] NVARCHAR (100) NOT NULL,
    CONSTRAINT [PK_BudgetAssignments] PRIMARY KEY CLUSTERED ([UserId], [Country], [Year], [Month], [ItemId]),
    CONSTRAINT [FK_BudgetAssignments_Users] FOREIGN KEY ([UserId]) REFERENCES [core].[Users] ([Id]) ON DELETE CASCADE,
    CONSTRAINT [CK_BudgetAssignments_Month] CHECK ([Month] BETWEEN 1 AND 12)
);
