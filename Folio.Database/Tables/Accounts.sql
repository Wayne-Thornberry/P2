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