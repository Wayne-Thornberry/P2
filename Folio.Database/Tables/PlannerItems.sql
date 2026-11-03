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