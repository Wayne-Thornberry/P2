-- The one account's preferences. One row per user, not per country: the country the
-- user chose is a column here, and it selects which set of the other tables is read.
CREATE TABLE [folio].[Settings]
(
    [UserId]            INT           NOT NULL,
    [Theme]             VARCHAR (16)  NOT NULL,
    [Locale]            NVARCHAR (32) NOT NULL,
    [Currency]          CHAR (3)      NOT NULL,
    [DateStyle]         VARCHAR (8)   NOT NULL,
    [TimeStyle]         VARCHAR (4)   NOT NULL,
    [Country]           NVARCHAR (40) NULL,
    [BillableMonthStart] TINYINT      NOT NULL CONSTRAINT [DF_Settings_BillableMonthStart] DEFAULT (1),
    [BalanceCutoffTxId] INT           NULL,
    CONSTRAINT [PK_Settings] PRIMARY KEY CLUSTERED ([UserId]),
    CONSTRAINT [FK_Settings_Users] FOREIGN KEY ([UserId]) REFERENCES [core].[Users] ([Id]) ON DELETE CASCADE,
    CONSTRAINT [CK_Settings_BillableMonthStart] CHECK ([BillableMonthStart] BETWEEN 1 AND 28)
);
