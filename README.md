# Folio — a private budget on your own box

Folio is a personal finance app: envelope budgeting, a transaction log with CSV import,
accounts, savings goals, loans, reports, a calendar, a what-if calculator and a financial
health score. It follows one person's money across whatever countries they keep a budget
in, and it runs on a single Windows box: IIS serves the site and the API, and SQL Server
sits beside them.

The rules a change has to obey, and the handful that must never be broken, are in
[AGENTS.md](AGENTS.md).

```
                    ┌───────────────────────────────────────┐
  browser ─────────►│  http://box:5420       one IIS site   │
                    │                                       │
                    │  /          the portal                │
                    │  /folio     the budget                │
                    └──────────────┬────────────────────────┘
                                   │  fetch
                                   │  (cross-origin: the API allows it)
                    ┌──────────────▼────────────────────────┐
                    │  http://box:5423       one IIS site   │
                    │  Folio.Api                            │
                    │    /api/core/...    the module list   │
                    │    /api/folio/...   the budget        │
                    └──────────────┬────────────────────────┘
                                   │
                    ┌──────────────▼────────────────────────┐
                    │  SQL Server      database Folio       │
                    │    folio.Transactions, folio.Budget…  │
                    │    keyed on (Country, Id)             │
                    └───────────────────────────────────────┘
```

## What is where

| Path | What it is |
| --- | --- |
| [Folio.Api](Folio.Api) | The one backend. An area per module under `/api/<module>`, plus `/api/health`. |
| [Folio.Database](Folio.Database) | The schema as an SSDT project: `Schemas/`, `Types/`, `Tables/` are the model, `Scripts/Migrations/` is its numbered history. |
| [Folio.Api.Tests](Folio.Api.Tests) | xUnit. Each test class builds its own throwaway SQL Server database from the same scripts. |
| [Folio.Web](Folio.Web) | The site. One Vue app; a folder per module under [src/modules](Folio.Web/src/modules). |
| [scripts](scripts) | `lib.ps1`, the functions `start.ps1` and the deploy share. Nothing there is run directly. |
| [start.ps1](start.ps1) | Runs the whole thing locally in one window. |
| [.github/workflows](.github/workflows) | `ci.yml` on a branch or a pull request, `deploy.yml` on `main` and by hand, `release.yml` for tags. |

**One site, modules inside it.** The portal at `/` lists the apps; each app is a route in
the same Vue build, in its own folder with its own pages, state, styles and tests. The
routes are lazy, so each app still ships as its own JavaScript chunk, while the shared
parts — the API client, the header — exist once.

Folio is the first module, at `/folio`. It is one module rather than one per page because
the budget, the accounts and the reports all read the same transactions: splitting them
would only mean passing the same rows between modules. Inside it, the sidebar is the app's
own navigation.

## The data

Folio keeps each area of its state as one collection — accounts, transactions, the budget,
the template, goals, finance, the planner, import history — and the site reads and writes
the whole collection.

- **The API is the database's only client.** `GET /api/folio/workspace?country=<id>` reads
  every collection for the signed-in user and that country. `PUT /api/folio/<collection>`
  replaces one of them, in a transaction, and is how every change is saved.
- **One table per entity.** A collection maps onto real columns and keys: transactions in
  `folio.Transactions`, the envelope assignments in `folio.BudgetAssignments`, a goal's
  contributions in `folio.SavingsContributions`, and so on. The model is in
  [Tables](Folio.Database/Tables) and the mapping in
  [FolioDbContext](Folio.Api/Data/FolioDbContext.cs).
- **Country is part of the key.** Every table is keyed on `(UserId, Country, Id)`, so the
  budget for Ireland and the budget for Sweden are separate sets of rows and switching
  country switches which ones are loaded.
- **The browser keeps a copy.** [workspace.ts](Folio.Web/src/modules/folio/workspace.ts)
  fetches the saved workspace before the app starts and puts it where the stores already
  look; a change is written to the browser immediately and sent to the API shortly after.
  A save that cannot reach the server is retried on the next change rather than lost.

## No sign-in

There is no account, no password and no session. This is a budget on a private box: the
site is open to whoever can reach it on the network, and the only thing separating one
budget from another is the country it was kept for.

**Every table is keyed on `(Country, Id)`.** There is no users table to key on, and the
API's endpoints take a country rather than an identity. A test fails if a `UserId` column
ever reappears.

## Running it locally

A local run has **no database**. The site talks to its own mock API, which serves a
complete example budget from memory: the budget, three months of transactions, four
accounts, two savings goals, a loan, a planner scenario and an import history. Changes are
live and interactive, and vanish when you stop it.

Requirements: Node 22+ and PowerShell. That is all — no SQL Server, no LocalDB, and no
.NET SDK unless you use `-Api`.

```powershell
.\start.ps1            # the site and the mock API  → http://127.0.0.1:5420
.\start.ps1 -Api       # the real API, against a database you configured
```

Two processes, whatever the number of apps: an API (mock or real) and the site. It signs
you in as `wayne` / `mock` and opens the browser.

`-Api` is for the rarer case of running the real API: it reads
`Folio.Api\appsettings.Development.json` (gitignored — copy the `.example`) and expects a
database that has **already been deployed**, because applying the schema is the deploy's
job. Without a database to point at, leave it off.

| | Port | |
| --- | --- | --- |
| Site | 5420 | `http://127.0.0.1:5420` |
| Mock API | 5490 | the default; `npm --prefix Folio.Web run mock` runs it alone |
| API (development) | 5421 | what the dev server proxies `/api` to with `-Api` |
| API (deployed) | 5423 | baked in at build time, and the API's IIS binding |

A port is changed where it is used: the site's and the dev proxy's in
[vite.config.ts](Folio.Web/vite.config.ts), the deployed pair in
[deploy.yml](.github/workflows/deploy.yml), and the local pair in [start.ps1](start.ps1).

### The mock

[Folio.Web/mocks/server.mjs](Folio.Web/mocks/server.mjs) answers the same paths as the API
with the same shapes, including the `{ "error": "…" }` body a refusal carries; the data it
serves comes from [seed.mjs](Folio.Web/mocks/seed.mjs) beside it. Because the site cannot
tell the two apart, everything you can do against a deployed API you can do locally with no
database at all.

## Tests

```powershell
dotnet test Folio.Api.Tests\Folio.Api.Tests.csproj      # API and database
dotnet build Folio.Database\Folio.Database.sqlproj      # the model, to a .dacpac

npm --prefix Folio.Web test                             # the site
npm --prefix Folio.Web run build                        # types and the bundle
```

The API tests build their own throwaway database from the model scripts and then apply the
migrations, which is what proves a migration still lands a database where the model says it
should be. They **skip** when no SQL Server is reachable — which is the normal local case,
since a local run has no database — and `Folio_REQUIRE_DATABASE_TESTS=1` turns that skip
into a failure, which is what the deploy sets.

## Deploying it

> **The deploy needs a SQL Server.** Its bootstrap step creates the database, and the API
> reads it, so a box without one cannot finish a deploy. Nothing in this repository
> installs one. Until a database exists — on the box, or reachable from it and named by the
> `SQL_SERVER` variable — a local run is the mock and the deploy stays parked.

Everything runs on the server itself: the runner builds in place and deploys to the folders
IIS is already serving. Two IIS sites, created and kept true by the deploy's bootstrap step:

| Site | Serves | Port |
| --- | --- | --- |
| `Folio` | the site, from `C:\Program Files\FolioWeb` | 5420 |
| `FolioApi` | the API, from `C:\Program Files\FolioApi` | 5423 |

### A new project in two steps

1. **On GitHub**: create the repository and register a runner for it, installed as
   `NT AUTHORITY\SYSTEM` (Settings → Actions → Runners → New self-hosted runner).
2. **Set `WEB_PUBLIC_ORIGIN`** to where browsers load the site from, e.g.
   `http://<box>:5420`. The API allows that origin through CORS.

Push, and run *Deploy to Production* once by hand. That first run bootstraps the box —
folders, app pools, both sites on the ports in [deploy.yml](.github/workflows/deploy.yml),
firewall rules, the database and its Windows grants — and then deploys on top of what it
made. Every statement in the bootstrap is idempotent, so it runs on every deploy and repairs
drift instead of failing on it.

### Settings

| Name | Kind | What it does |
| --- | --- | --- |
| `WEB_PUBLIC_ORIGIN` | variable | The origin browsers load the site from; the API's CORS allow-list. |
| `SQL_SERVER` | variable | Optional. Defaults to `localhost` — the same box. |
| `DB_NAME` | variable | Optional. Defaults to `Folio`. |

**There are no secrets.** With no account there is no password to store, so the repository
and the Actions settings hold none. The deploy writes the connection string and the CORS
origins into `appsettings.Production.json` on the box on every deploy.

### The box, once — not once per project

IIS and the ASP.NET Core hosting bundle, SQL Server, and a runner. The deploy installs
`sqlpackage` itself if it is missing, and creates the database and grants the runner and
the API's app pool what they need in Windows terms — no SQL login, no password.

The grants are made twice on purpose: once by the bootstrap step when the database is
created, and again straight after every publish. `sqlpackage` runs with
`DropObjectsNotInSource`, which is what actually drops a column the model no longer has —
and it drops a database user the project does not describe too, which is both of them.
Without the second pass the API loses its own user and answers 503 on a database that is
perfectly there.

The one thing that needs a sysadmin once is creating those logins: the runner account has
to be a sysadmin for that first bootstrap. See the failure message the bootstrap prints if
it is not.

## Licence

MIT — see [LICENSE](LICENSE).
