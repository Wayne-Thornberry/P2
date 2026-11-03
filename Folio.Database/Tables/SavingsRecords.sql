-- A savings account being tracked for its interest, as a loan is tracked for its
-- repayments. Named SavingsRecords rather than SavingsAccounts so it does not read as one
-- of the user's Accounts.
CREATE TABLE [folio].[SavingsRecords]
(
    [Country]         NVARCHAR (40)  NOT NULL,
    [Id]              INT            NOT NULL,
    [Name]            NVARCHAR (100) NOT NULL,
    [Apr]             DECIMAL (9, 6) NOT NULL,
    [CompoundFreq]    VARCHAR (12)   NOT NULL,
    [StartBalance]    DECIMAL (18, 4) NOT NULL,
    [StartDate]       DATE           NOT NULL,
    [LinkedAccountId] NVARCHAR (32)  NULL,
    [Color]           NVARCHAR (32)  NOT NULL,
    [CreatedAt]       DATETIME2 (3)  NOT NULL,
    [Archived]        BIT            NOT NULL,
    [SortOrder]       INT            NOT NULL,
    CONSTRAINT [PK_SavingsRecords] PRIMARY KEY CLUSTERED ([Country], [Id]),
    CONSTRAINT [CK_SavingsRecords_CompoundFreq] CHECK ([CompoundFreq] IN ('monthly', 'quarterly', 'annually'))
);