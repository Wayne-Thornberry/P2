-- The two schemas this project keeps its data in.
--
-- folio is the budget: whoever is signed in has their own rows in every one of its
-- tables, keyed on (UserId, Country, Id).
--
-- auth is who is asking, kept apart because it is a different question -- dropping or
-- restoring the budget's tables leaves the accounts alone, and the other way round.
CREATE SCHEMA [folio] AUTHORIZATION [dbo];
GO

CREATE SCHEMA [auth] AUTHORIZATION [dbo];
GO