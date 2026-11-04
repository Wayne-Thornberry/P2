-- A loan being paid off. The amortisation schedule is worked out from these figures
-- rather than stored: it is a projection, and a stored one would go stale the moment an
-- extra payment was made.
CREATE TABLE [folio].[Loans]
(
    [UserId]          INT            NOT NULL,
    [Country]         NVARCHAR (40)  NOT NULL,
    [Id]              INT            NOT NULL,
    [Name]            NVARCHAR (100) NOT NULL,
    [Principal]       DECIMAL (18, 4) NOT NULL,
    [Apr]             DECIMAL (9, 6) NOT NULL,
    [TermMonths]      INT            NOT NULL,
    [StartDate]       DATE           NOT NULL,
    [LinkedAccountId] NVARCHAR (32)  NULL,
    [Color]           NVARCHAR (32)  NOT NULL,
    [CreatedAt]       DATETIME2 (3)  NOT NULL,
    [Archived]        BIT            NOT NULL,
    [SortOrder]       INT            NOT NULL,
    CONSTRAINT [PK_Loans] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]),
    CONSTRAINT [FK_Loans_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id])
);