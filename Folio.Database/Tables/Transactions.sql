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