# Migrations

Changes for a database that is already deployed. Each file is numbered, runs in filename
order, and **runs on every deploy** -- there is no journal table recording what has been
applied, so the safety comes from the script being idempotent rather than from being
recorded.

```sql
-- 0001_TransactionCleared.sql
IF COL_LENGTH(N'folio.Transactions', N'Cleared') IS NULL
    ALTER TABLE [folio].[Transactions] ADD [Cleared] BIT NOT NULL CONSTRAINT [DF_Transactions_Cleared] DEFAULT (0);
GO
```

## The two rules

1. **Never edit a script that has been deployed.** A deploy will not re-run it, and the
   live database will not match the file. Add the next number beside it.
2. **Make every script idempotent.** It is applied to databases in every state: one built
   from the model five minutes ago, and one that has carried data since the first
   release. `IF NOT EXISTS` / `IF COL_LENGTH(...) IS NULL` / `IF OBJECT_ID(...) IS NULL`
   is what makes running it twice harmless.

## Adding a change

1. Edit the model (`Tables/`, `Types/`, `Schemas/`) so a database built from scratch has
   the new shape.
2. Add the numbered script here so a database that already exists gains it.

The two must agree: the script takes an old database to exactly what the model describes,
and SqlPackage then finds nothing left to change. The API's tests build a database from
the model and re-run these scripts, which is what catches the two drifting apart.

A script is for changes the model cannot express as a diff on its own -- moving data,
splitting a column, adding a row that is not reference data.
