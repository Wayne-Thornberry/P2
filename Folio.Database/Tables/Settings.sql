-- The preferences. One row, enforced by the check: there is one person using this budget,
-- so a table of settings for different people would only hold one.
--
-- The country it names is a column, and it selects which rows of the other tables the site
-- reads.
CREATE TABLE [folio].[Settings]
(
    [Id]                 TINYINT      NOT NULL CONSTRAINT [DF_Settings_Id] DEFAULT (1),
    [Theme]              VARCHAR (16) NOT NULL,
    [Locale]             NVARCHAR (32) NOT NULL,
    [Currency]           CHAR (3)     NOT NULL,
    [DateStyle]          VARCHAR (8)  NOT NULL,
    [TimeStyle]          VARCHAR (4)  NOT NULL,
    [Country]            NVARCHAR (40) NULL,
    [BillableMonthStart] TINYINT      NOT NULL CONSTRAINT [DF_Settings_BillableMonthStart] DEFAULT (1),
    [BalanceCutoffTxId]  INT          NULL,
    CONSTRAINT [PK_Settings] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [CK_Settings_OneRow] CHECK ([Id] = 1),
    CONSTRAINT [CK_Settings_BillableMonthStart] CHECK ([BillableMonthStart] BETWEEN 1 AND 28)
);