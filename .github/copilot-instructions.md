# Copilot instructions

[AGENTS.md](../AGENTS.md) is the source of truth for how to work in this repository — read
it before changing anything. In short:

- **Never edit or rename a migration in `Folio.Database/Scripts/Migrations` that has
  shipped.** Add the next number, and make it idempotent. The model (`Schemas/`, `Types/`,
  `Tables/`) is the schema; a migration is only for data that a diff cannot move.
- **No SQL logins or passwords.** Windows authentication, granted by the deploy's bootstrap
  step.
- **The API is open.** There is no sign-in and no sessions: the box is private, so the
  endpoints are not guarded. Do not reintroduce a user, a token or a `UserId` column.
- **The API never creates a schema object.** "Invalid object name" means the database has
  not been deployed.
- **`npm ci` inside `Folio.Web`.** No npm workspaces — this tree cannot create symlinks.
- **A local run has no database.** `.\start.ps1` serves the site from the mock in
  `Folio.Web/mocks`, whose example budget lives in `mocks/seed.mjs`. Anything the site can
  do against a deployed API it must still do against that mock, so keep the two in step.
  `-Api` is the only path that touches a real database.
- **A collection is saved whole.** The site keeps each of Folio's nine collections as one
  aggregate and `PUT`s it to `/api/folio/<collection>?country=<id>`; the API replaces the
  rows for that user and country inside a transaction. A new field has to be added on both
  sides, in `FolioDbContext`, in `WorkspaceService` and in the module's TypeScript types.
- **An app is a schema + tables + migration, a class implementing
  [IFolioModule](../Folio.Api/Modules/IFolioModule.cs), a folder under
  `Folio.Web/src/modules` with one line in `registry.ts`, and tests on both sides.** Its
  name is its `/api/<name>` route and its `/<name>` page route.

Build and test before you finish: `dotnet test Folio.Api.Tests\Folio.Api.Tests.csproj`
and `npm --prefix Folio.Web test`, plus `npm --prefix Folio.Web run build` when the
site changed.
