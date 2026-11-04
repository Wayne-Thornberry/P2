-- A line in a saved scenario. [Source] records where the figure came from -- a real
-- transaction, a standing commitment, or one typed into the scenario -- so the scenario
-- still means something once the transaction behind it changes.
CREATE TABLE [folio].[PlannerSimulationItems]
(
    [UserId]        INT            NOT NULL,
    [Country]       NVARCHAR (40)  NOT NULL,
    [Id]            INT            NOT NULL,
    [SimulationId]  INT            NOT NULL,
    [Name]          NVARCHAR (100) NOT NULL,
    [Amount]        DECIMAL (18, 4) NOT NULL,
    [Kind]          VARCHAR (8)    NOT NULL,
    [Source]        VARCHAR (16)   NOT NULL,
    [TransactionId] INT            NULL,
    [PlannerItemId] INT            NULL,
    [SortOrder]     INT            NOT NULL,
    CONSTRAINT [PK_PlannerSimulationItems] PRIMARY KEY CLUSTERED ([UserId], [Country], [Id]),
    CONSTRAINT [FK_PlannerSimulationItems_PlannerSimulations] FOREIGN KEY ([UserId], [Country], [SimulationId])
        REFERENCES [folio].[PlannerSimulations] ([UserId], [Country], [Id]),
    CONSTRAINT [CK_PlannerSimulationItems_Kind] CHECK ([Kind] IN ('income', 'expense')),
    CONSTRAINT [CK_PlannerSimulationItems_Source] CHECK ([Source] IN ('transaction', 'planner', 'custom')),
    CONSTRAINT [FK_PlannerSimulationItems_AuthUsers] FOREIGN KEY ([UserId]) REFERENCES [auth].[Users] ([Id])
);
GO

CREATE NONCLUSTERED INDEX [IX_PlannerSimulationItems_Simulation]
    ON [folio].[PlannerSimulationItems] ([UserId], [Country], [SimulationId]);