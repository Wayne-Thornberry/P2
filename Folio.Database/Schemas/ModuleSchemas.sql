-- The one schema this project keeps its data in.
--
-- There is no core schema and no users table: this is a budget on a private box, used by
-- one person, so there is nobody to sign in as and nothing to separate rows by.
CREATE SCHEMA [folio] AUTHORIZATION [dbo];
GO