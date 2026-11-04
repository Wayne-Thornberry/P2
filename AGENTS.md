# AGENTS.md

How to work in this repository — for a person in a hurry and for an AI assistant. The
long version, and the *why* of each rule, is in [README.md](README.md).

**What this is.** Folio is a personal budget. It is one ASP.NET Core API
([Folio.Api](Folio.Api)), one SQL Server database as an SSDT project
([Folio.Database](Folio.Database)), one Vue + TypeScript site holding the app
([Folio.Web](Folio.Web)), tests for both sides, and a deploy to IIS on a single Windows
box. The site is the budget itself, on one module — `folio` — with no page in front of it.

## The rules that are not negotiable

1. **A deployed migration is history.** Scripts in `Folio.Database/Scripts/Migrations`
   are applied in filename order on every deploy, with no journal table to notice a
   repeat. Never edit or rename one that has shipped; add the next number.
2. **Every migration is idempotent.** It runs against a database built from the model
   minutes ago *and* one that has carried data since the first release. Guard with
   `IF COL_LENGTH(...) IS NULL`, `IF NOT EXISTS (...)`, `MERGE`, and so on.
3. **The model is the schema.** Tables, types, schemas and constraints live in
   `Schemas/`, `Types/` and `Tables/` and are compiled into a `.dacpac`. A migration is
   only for what a diff cannot express: moving or filling data. Do not create a table in
   a migration.
4. **No SQL logins and no SQL passwords.** The API, the runner and the tests connect with
   Windows authentication, granted by the deploy's bootstrap step. If something fails with
   "login failed", the answer is a grant, never a credential.
5. **The API is open.** There is no sign-in: this is a budget on a private box, and an
   account would only be a password in front of a door nobody else can reach. Do not
   reintroduce sessions or a `UserId` — the data is keyed on `(Country, Id)`.
6. **The API never creates a database object.** It reads and writes tables that a deploy
   already made. "Invalid object name" means the database has not been deployed.
7. **`npm ci` in `Folio.Web`, never a workspace.** This tree lives on a network share
   that cannot create the symlinks npm workspaces need. One project, one `node_modules`.
8. **A module's name is used twice**: `/api/<name>` on the API and `/<name>` on the site.
   The two are one app seen from both sides, so they must be equal.
9. **Every table in the `folio` schema is keyed on `(Country, Id)`.** One person can keep a
   budget for more than one country, and each is a separate set of rows.
10. **A rule lives on the server.** What makes a row valid, what a number means, what the
    page is shown belongs to the module's service class and the endpoints it feeds. The
    site displays what comes back and formats it. A rule kept in both places drifts, and
    the browser's copy is the one no test covers.

## The data

Folio keeps nine collections per country, and the site holds each of them as one
aggregate — the shape its stores already had when they lived in `localStorage`:

| Collection | Table(s) in `folio` |
| --- | --- |
| `folio_accounts` | `Accounts`, `Counters` |
| `folio_transactions` | `Transactions` |
| `folio_upcoming` | `UpcomingTransactions` |
| `folio_budget` | `BudgetItems`, `BudgetAssignments` |
| `folio_template` | `BudgetTemplateEntries` |
| `folio_savings_goals` | `SavingsGoals`, `SavingsContributions` |
| `folio_finance` | `Loans`, `SavingsRecords` |
| `folio_planner` | `PlannerState`, `PlannerItems`, `PlannerSimulations`, `PlannerSimulationItems` |
| `folio_import_history` | `ImportHistory` |

`GET /api/folio/workspace?country=<id>` reads them all; `PUT /api/folio/<collection>` replaces
one inside a transaction. Settings are one row per user (`folio.Settings`) and have their
own GET and PUT. The site's [workspace.ts](Folio.Web/src/modules/folio/workspace.ts) is the
only file that knows the browser's copy is a cache: it primes it before the app starts and
sends a collection back once the user has stopped changing it.

**Adding a field** means: a column in `Tables/`, a property on the row class and the mapping
in [FolioDbContext](Folio.Api/Data/FolioDbContext.cs), the member on the collection's
DTO, the code in [WorkspaceService](Folio.Api/Modules/Folio/WorkspaceService.cs) that reads
and writes it, the TypeScript type in the module, and a test.

## Adding an app

1. **Database** — a schema (`Schemas/`), its tables (`Tables/`), and the same thing again
   as the next numbered migration for databases that already exist.
2. **API** — a folder under `Folio.Api/Modules`, a class implementing
   [IFolioModule](Folio.Api/Modules/IFolioModule.cs) with `Name` and `Map`, and the
   entities mapped in `FolioDbContext`. The catalog finds it by reflection; nothing
   registers it.
3. **Site** — a folder under [src/modules](Folio.Web/src/modules) with its page, an
   `index.ts` exporting its route, and a line in `src/modules/registry.ts`. The recipe is
   in [src/modules/README.md](Folio.Web/src/modules/README.md).
4. **Tests** — a class in `Folio.Api.Tests` for the endpoints, a `*.test.ts` beside the
   site's logic. Both are expected, not optional.

Nothing in `start.ps1`, the build, the workflow or the deploy changes when an app is added.

## Commands

```powershell
.\start.ps1                                             # the site and the mock API
.\start.ps1 -Api                                        # the real API (needs a database)

dotnet build Folio.sln
dotnet test Folio.Api.Tests\Folio.Api.Tests.csproj
dotnet build Folio.Database\Folio.Database.sqlproj        # the model, to a .dacpac

npm --prefix Folio.Web test
npm --prefix Folio.Web run build
```

**A local run has no database.** The default `.\start.ps1` serves the site from the mock in
`Folio.Web/mocks`, which holds a full example budget in memory; that is how the app is
exercised day to day. `-Api` is only for pointing the real API at a database that has
already been deployed.

API tests that need SQL build a throwaway database of their own from the model scripts and
the migrations, then drop it. They **skip** when no SQL Server is reachable — the normal
local case, since a local run has no database. `Folio_REQUIRE_DATABASE_TESTS=1` turns a
skip into a failure, which is what the deploy sets, and `Folio_TEST_SQL_SERVER` points
them at a server.

## Style

- Match the file you are editing. This codebase explains *why* in comments and leaves the
  obvious alone; a comment that restates the line above it is a bug.
- No dead code, no commented-out blocks, no `TODO` for something you could finish.
- The site's short comments and prose use British spelling ("colour", "initialise"); the
  identifiers do not.
- A change that only touches one side of the API/site pair is usually half a change: check
  the other side and the tests before calling it done.
