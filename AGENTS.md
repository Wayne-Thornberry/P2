# AGENTS.md

How to work in this repository — for a person in a hurry and for an AI assistant. The
long version, and the *why* of each rule, is in [README.md](README.md).

**What this is.** Folio is a personal budget. It is one ASP.NET Core API
([Folio.Api](Folio.Api)), one SQL Server database as an SSDT project
([Folio.Database](Folio.Database)), one Vue + TypeScript site holding the app
([Folio.Web](Folio.Web)), tests for both sides, and a deploy to IIS on a single Windows
box. The site is the budget itself, on one module — `folio` — with no page in front of it.

**Run it** with `.\start.ps1` (`-Mock` for no API, `-Rebuild` to rebuild the database from
the model). It builds, migrates and starts both processes; the site then asks you to sign
in, and offers to make the first account if the box has none.

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
   Windows authentication, granted once by [setup.ps1](setup.ps1). If something fails with
   "login failed", the answer is a grant, never a credential.
5. **Every row belongs to an account.** The API has accounts: `auth.Users` says who may sign
   in, `auth.Sessions` remembers which browser has, and every table in the `folio` schema
   carries the `UserId` that owns the row. Nothing is read or written without one, and an
   endpoint added to the module group is behind the sign-in by not having said otherwise.
   Do not add a folio query that does not filter on the account.
6. **The API never creates a database object.** It reads and writes tables that a deploy
   already made. "Invalid object name" means the database has not been deployed.
7. **`npm ci` in `Folio.Web`, never a workspace.** This tree lives on a network share
   that cannot create the symlinks npm workspaces need. One project, one `node_modules`.
8. **A module's name is used twice**: `/api/<name>` on the API and `/<name>` on the site.
   The two are one app seen from both sides, so they must be equal.
9. **Every row of a budget is keyed on `(UserId, Country, Id)`.** An account has its own
   budget, and one person may keep one for more than one country; each country is a separate
   set of rows inside that account rather than a tagged pile.
10. **A rule lives on the server.** What makes a row valid, what a number means, what the
    page is shown belongs to the module's service class and the endpoints it feeds. The
    site displays what comes back and formats it. A rule kept in both places drifts, and
    the browser's copy is the one no test covers.
11. **Nothing that is served is kept.** The API says `no-store` from one middleware in
    [Program.cs](Folio.Api/Program.cs); the site says it from the headers in
    [web.config](Folio.Web/web.config), which is why there is no `clientCache` element
    beside them — it can only say `no-cache`, and it writes a second `Cache-Control`. A
    cached `index.html` is a page that asks for bundles the last deploy deleted. The
    deploy's two smoke tests read the header back so this cannot be lost quietly.

## The data

Folio keeps nine collections per country per account, and the site holds each of them as one
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
one inside a transaction. Neither asks who is calling: the session cookie says whose budget
it is, and the services filter on it. Settings are one row per account (`folio.Settings`) and
have their own GET and PUT. The site's
[workspace.ts](Folio.Web/src/modules/folio/workspace.ts) is the only file that knows the
browser's copy is a cache: it primes it before the app starts and sends a collection back
once the user has stopped changing it.

**Adding a field** means: a column in `Tables/`, a property on the row class and the mapping
in [FolioDbContext](Folio.Api/Data/FolioDbContext.cs), the member on the collection's
DTO, the code in [WorkspaceService](Folio.Api/Modules/Folio/WorkspaceService.cs) that reads
and writes it — including the `UserId` every query filters on — the TypeScript type in the
module, and a test.

## Accounts

`auth.Users` is one person who may sign in; `auth.Sessions` is one browser that has. The
password is a PBKDF2 hash and its own salt, never the password, and the session cookie holds
a random token whose SHA-256 is what the table keeps — so a copy of the table is not a set
of working sessions.

- **The first account is made from the page** (`POST /api/auth/claim`), because a box with
  no accounts has nobody who could be handed a password by the box. It takes up the
  placeholder row the migration made, which already owns whatever was saved before accounts
  existed. It can only happen once.
- **Every other account is made on the box**, with
  `dotnet run --project Folio.Api -- --add-user <name>`. That prints a one-time password and
  stores only its hash; the account answers 403 to everything except changing that password
  until it has been replaced.
- **A PIN is the way back in** when a password is forgotten. Six digits is guessable, so
  wrong ones are counted and the fifth buys a wait.
- The rules are in [AccountRules](Folio.Api/Auth/AccountRules.cs); the site's copy in
  [rules.ts](Folio.Web/src/auth/rules.ts) only lets a form say what is wrong sooner.

## The AI

Two features ask DeepSeek, and both are on a button because both cost a call:

- **The report** (`POST /api/folio/analysis`) on the Reports page, for all accounts or the
  ones picked. **The numbers in it are the API's** — every total, average, share, trend and
  over-budget line in [AnalysisService](Folio.Api/Modules/Folio/AnalysisService.cs) is
  arithmetic over saved rows and is tested without a model. DeepSeek is given those facts and
  asked only for the reading of them: the headline, the findings, the patterns, the risks,
  the actions.
- **The categorising** (`POST /api/folio/categorise`) on the Transactions page, for the
  selected rows or — with nothing selected — every row in the country that has no item yet,
  which is a set the API picks. **The question is asked per payee, not per row**: the rows
  that share a name share an item, so a budget of thousands of transactions is a few hundred
  questions and a handful of calls. Two things cost nothing at all: a payee the budget has
  already categorised (the user's own answer, reused) and a name the model has already
  placed. The answer is a *proposal*: the item, the reason and a confidence, with any new
  items named but not created. The page applies it through the stores, so it is saved the
  way every other edit is. An existing item wins wherever one fits, matched by its name
  however it is spelt, and a new one is a last resort capped at eight.

The key is `Ai:DeepSeek:ApiKey`, from the `DEEPSEEK_API_KEY` repository secret via
appsettings.Production.json, or from the environment for a local run. **Empty means no AI**:
`GET /api/folio/ai` answers `available: false`, neither page offers its button, and the two
endpoints answer 503 rather than reaching for a key that is not there. A model that answers
with something that is not the shape asked for is the same refusal — nothing is half-applied.

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

Nothing in `start.ps1`, `setup.ps1`, the build, the workflow or the deploy changes when an
app is added: an app lives inside the schema and the site the project already has.

## Commands

```powershell
.\start.ps1                                             # LocalDB, migrated, with the real API
.\start.ps1 -Rebuild                                    # the same, database dropped first
.\start.ps1 -Dev                                        # a shared database, read and written
.\start.ps1 -Mock                                       # no API and no database: the fake one

dotnet build Folio.sln
dotnet test Folio.Api.Tests\Folio.Api.Tests.csproj
dotnet build Folio.Database\Folio.Database.sqlproj        # the model, to a .dacpac

npm --prefix Folio.Web test
npm --prefix Folio.Web run build
```

**The site can talk to two APIs.** `.\start.ps1` builds a LocalDB database from the model
and serves the real API against it; `-Mock` serves the fake API in `Folio.Web/mocks`
instead, which holds a full example budget in memory and saves nothing. Anything the site
can do against the real API it must still do against that mock — `MockParityTests` fails
when the two drift, and it compares the workspace, the health score, the dashboard and the
finance summary field by field.

API tests that need SQL build a throwaway database of their own from the model scripts and
the migrations, then drop it. They **skip** when no SQL Server is reachable.
`Folio_REQUIRE_DATABASE_TESTS=1` turns a skip into a failure, which is what the deploy
sets, and `Folio_TEST_SQL_SERVER` points them at a server.

## Style

- Match the file you are editing. This codebase explains *why* in comments and leaves the
  obvious alone; a comment that restates the line above it is a bug.
- No dead code, no commented-out blocks, no `TODO` for something you could finish.
- The site's short comments and prose use British spelling ("colour", "initialise"); the
  identifiers do not.
- A change that only touches one side of the API/site pair is usually half a change: check
  the other side and the tests before calling it done.
