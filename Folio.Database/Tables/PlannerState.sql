-- The quick calculator's own state: the income it starts from, and which saved
-- simulation the user marked as the ideal. The commitments are PlannerItems, and the
-- what-if scenarios are PlannerSimulations. One row per country.
CREATE TABLE [folio].[PlannerState]
(
    [Country]           NVARCHAR (40)  NOT NULL,
    [Income]            DECIMAL (18, 4) NOT NULL,
    [IdealSimulationId] INT            NULL,
    CONSTRAINT [PK_PlannerState] PRIMARY KEY CLUSTERED ([Country])
);