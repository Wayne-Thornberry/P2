-- A saved what-if scenario, for one month ("2025-03").
CREATE TABLE [folio].[PlannerSimulations]
(
    [UserId]    INT            NOT NULL,
    [Country]   NVARCHAR (40)  NOT NULL,
    [Id]        INT            NOT NULL,
    [Name]      NVARCHAR (100) NOT NULL,
    [Month]     CHAR (7)       NOT NULL,
    [SortOrder] INT            NOT NULL,
    CONSTRAINT [PK_PlannerSimulations] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]),
    CONSTRAINT [FK_PlannerSimulations_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id])
);