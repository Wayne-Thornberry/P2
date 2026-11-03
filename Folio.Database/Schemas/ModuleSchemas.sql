-- One schema per module, plus core for the account everyone signs in with.
--
-- A module's tables live in its own schema, so they can be found, backed up or dropped
-- without reading anyone else's. Adding a module adds a schema here.
CREATE SCHEMA [core] AUTHORIZATION [dbo];
GO

CREATE SCHEMA [folio] AUTHORIZATION [dbo];
GO
