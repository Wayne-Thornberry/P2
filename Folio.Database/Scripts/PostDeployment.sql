-- Reference data. Runs on every deploy, so every block inserts only the rows that are
-- missing: nothing is ever updated or deleted, which means an edit made in the running
-- app survives a deployment.
--
-- There is nothing to seed yet. The one account is not reference data: its password
-- belongs to whoever deploys, so the API creates it from configuration when it meets an
-- empty database.
SET NOCOUNT ON;
SET XACT_ABORT ON;
