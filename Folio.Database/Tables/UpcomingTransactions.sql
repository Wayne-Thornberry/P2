-- Planned money that has not happened yet. [Done] marks one that has, and
-- [LinkedTransactionId] points at the transaction it became.
CREATE TABLE [folio].[UpcomingTransactions]
(
    [UserId]              INT            NOT NULL,
    [Country]             NVARCHAR (40)  NOT NULL,
    [Id]                  INT            NOT NULL,
    [Title]               NVARCHAR (200) NOT NULL,
    [Amount]              DECIMAL (18, 4) NOT NULL,
    [Type]                VARCHAR (3)    NOT NULL,
    [Date]                DATE           NOT NULL,
    [Notes]               NVARCHAR (1000) NULL,
    [Done]                BIT            NOT NULL,
    [LinkedTransactionId] INT            NULL,
    [CreatedAt]           DATETIME2 (3)  NOT NULL,
    [Recurring]           VARCHAR (8)    NULL,
    [SortOrder]           INT            NOT NULL,
    CONSTRAINT [PK_UpcomingTransactions] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]),
    CONSTRAINT [CK_UpcomingTransactions_Type] CHECK ([Type] IN ('in', 'out')),
    CONSTRAINT [CK_UpcomingTransactions_Recurring] CHECK ([Recurring] IS NULL OR [Recurring] IN ('weekly', 'monthly', 'yearly')),
    CONSTRAINT [FK_UpcomingTransactions_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id])
);