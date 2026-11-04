-- The preferences, one row per person.
--
-- The country it names is a column, and it selects which rows of the other tables the site
-- reads; the account it belongs to is the key, so nobody's settings are another person's.
--
-- It used to be one row, enforced by a check on its constant Id. The Id has gone: the
-- account is what there is one of these for.
CREATE TABLE [folio].[Settings]
(
    [UserId]             INT          NOT NULL,
    [Theme]              VARCHAR (16) NOT NULL,
    [Locale]             NVARCHAR (32) NOT NULL,
    [Currency]           CHAR (3)     NOT NULL,
    [DateStyle]          VARCHAR (8)  NOT NULL,
    [TimeStyle]          VARCHAR (4)  NOT NULL,
    [Country]            NVARCHAR (40) NULL,
    [BillableMonthStart] TINYINT      NOT NULL CONSTRAINT [DF_Settings_BillableMonthStart] DEFAULT (1),
    [BalanceCutoffTxId]  INT          NULL,
    CONSTRAINT [PK_Settings] PRIMARY KEY CLUSTERED ([UserId]),
    CONSTRAINT [FK_Settings_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id]),
    CONSTRAINT [CK_Settings_BillableMonthStart] CHECK ([BillableMonthStart] BETWEEN 1 AND 28)
);