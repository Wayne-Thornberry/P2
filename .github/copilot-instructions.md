# Copilot instructions

[AGENTS.md](../AGENTS.md) is the source of truth for how to work in this repository — read
it before changing anything. In short:

- **Never edit or rename a migration in `Folio.Database/Scripts/Migrations` that has
  shipped.** Add the next number, and make it idempotent. The model (`Schemas/`, `Types/`,
  `Tables/`) is the schema; a migration is only for data that a diff cannot move.
- **No SQL logins or passwords.** Windows authentication, granted once by `setup.ps1` on
  the box.
- **Every row belongs to an account.** `auth.Users`/`auth.Sessions` say who may sign in and
  which browser has, and every `folio` table carries the owning `UserId`. The module group is
  behind `SignedInFilter`; a folio query that does not filter on the account is a bug.
- **The first account is made from the page; every other one on the box** with
  `--add-user`. Do not add a sign-up screen.
- **The AI is the API's, and it is asked for.** DeepSeek is called only from
  [AnalysisService](Folio.Api/Modules/Folio/AnalysisService.cs) and
  [CategoriseService](Folio.Api/Modules/Folio/CategoriseService.cs), only when a button is
  pressed. The numbers a report is about are the API's arithmetic, never the model's; the
  model writes what they mean. A categorising answer is a proposal the page applies, not a
  write, and it is asked per payee — not per row — so the cost of a budget does not grow
  with its transaction count. No key means `GET /api/folio/ai` answers false and nothing
  offers either feature.
- **A rule lives on the server.** Rules, limits and computed values go in the module's
  service class on the API, and the page displays what comes back. Do not re-implement a
  rule in TypeScript for a faster message. `GET /api/folio/health` is the shape to copy.
- **The API never creates a schema object.** "Invalid object name" means the database has
  not been deployed.
- **`npm ci` inside `Folio.Web`.** No npm workspaces — this tree cannot create symlinks.
- **The site can talk to two APIs.** `.\start.ps1` builds a LocalDB database from the model
  and serves the real API against it; `-Mock` serves the fake API in `Folio.Web/mocks`,
  whose example budget lives in `mocks/seed.mjs`. Anything the site can do against the real
  API it must still do against that mock, so keep the two in step — `MockParityTests` fails
  when they drift, and it compares the workspace, the health score, the dashboard and the
  finance summary field by field.
- **A collection is saved whole.** The site keeps each of Folio's nine collections as one
  aggregate and `PUT`s it to `/api/folio/<collection>?country=<id>`; the API replaces the
  rows for that country and account inside a transaction. A new field has to be added on
  both sides, in `FolioDbContext`, in `WorkspaceService` and in the module's TypeScript types.
- **A computed view is asked for, not calculated.** Anything the API works out has its own
  `GET`; the site asks again when `workspace.ts` reports a save, so the figure on screen
  describes the budget as it was saved. `GET /api/folio/dashboard` is the second example.
- **An app is a schema + tables + migration, a class implementing
  [IFolioModule](../Folio.Api/Modules/IFolioModule.cs), a folder under
  `Folio.Web/src/modules` with one line in `registry.ts`, and tests on both sides.** Its
  name is its `/api/<name>` route and its `/<name>` page route.

Build and test before you finish: `dotnet test Folio.Api.Tests\Folio.Api.Tests.csproj`
and `npm --prefix Folio.Web test`, plus `npm --prefix Folio.Web run build` when the
site changed.
