-- Reference data. Runs on every deploy, so every block inserts only the rows that are
-- missing: nothing is ever updated or deleted, which means an edit made in the running
-- app survives a deployment.
--
-- There is nothing to seed. Nothing in this project is reference data: every row is
-- something the user typed.
SET NOCOUNT ON;
SET XACT_ABORT ON;
