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