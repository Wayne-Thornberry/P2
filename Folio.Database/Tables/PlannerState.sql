-- The quick calculator's own state: the income it starts from, and which saved
-- simulation the user marked as the ideal. The commitments are PlannerItems, and the
-- what-if scenarios are PlannerSimulations.
CREATE TABLE [folio].[PlannerState]
(
    [UserId]            INT            NOT NULL,
    [Country]           NVARCHAR (40)  NOT NULL,
    [Income]            DECIMAL (18, 4) NOT NULL,
    [IdealSimulationId] INT            NULL,
    CONSTRAINT [PK_PlannerState] PRIMARY KEY CLUSTERED ([UserId], [Country]),
    CONSTRAINT [FK_PlannerState_Users] FOREIGN KEY ([UserId]) REFERENCES [core].[Users] ([Id]) ON DELETE CASCADE
);
