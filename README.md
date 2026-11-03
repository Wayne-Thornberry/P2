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
                    │  /          the portal, and sign-in   │
                    │  /folio     the budget                │
                    └──────────────┬────────────────────────┘
                                   │  fetch, ******
                                   │  (cross-origin: the API allows it)
                    ┌──────────────▼────────────────────────┐
                    │  http://box:5423       one IIS site   │
                    │  Folio.Api                            │
                    │    /api/core/...    account, modules  │
                    │    /api/folio/...   the budget        │
                    └──────────────┬────────────────────────┘
                                   │
                    ┌──────────────▼────────────────────────┐
                    │  SQL Server      database Folio       │
                    │    core.Users    core.Sessions        │
                    │    folio.Transactions, folio.Budget…  │
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
parts — the API client, the session, the sign-in screen, the header — exist once.

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

## Signing in

One account, one password, one site. The token is kept in `localStorage` and sent as a
`Bearer` header; it is a row in `core.Sessions`, so a deploy (which recycles the app pool)
does not sign anyone out, and only its SHA-256 is stored.

`/account` replaces the password you know, given the current one, and signs out every other
browser. The sign-in page's *Forgotten the password?* replaces one you don't, given the
recovery code from configuration — no email, no reset table, nothing to expire. With no
recovery code configured, that endpoint refuses and the only way in is the box.

**The API refuses by default.** Everything under `/api` needs a session unless the endpoint
says `.AllowAnonymous()`.

## Running it locally

Requirements: .NET 8 SDK, Node 22+, SQL Server Express LocalDB (or a SQL Server to point
at), and PowerShell. No Java, and no `sqlpackage` — that is only installed on the box, by
the deploy.

```powershell
.\start.ps1            # LocalDB, migrated, with the real API  → http://localhost:5420
.\start.ps1 -Rebuild   # the same, but drop the database and rebuild it from the model
.\start.ps1 -Mock      # no API, no database: the site's own fake API
.\start.ps1 -Dev       # a shared database from appsettings.Development.json
```

Two processes, whatever the number of apps: the API and the site. The first run creates
the LocalDB instance and the database, starts both, and prints the account it seeded.

| | Port | |
| --- | --- | --- |
| Site | 5420 | `http://localhost:5420` |
| API (development) | 5421 | what the dev server proxies `/api` to |
| API (deployed) | 5423 | baked in at build time, and the API's IIS binding |
| Mock API | 5490 | only with `-Mock` |

A port is changed where it is used: the site's and the dev proxy's in
[vite.config.ts](Folio.Web/vite.config.ts), the deployed pair in
[deploy.yml](.github/workflows/deploy.yml), and the local pair in [start.ps1](start.ps1).

## Tests

```powershell
dotnet test Folio.Api.Tests\Folio.Api.Tests.csproj      # API and database
dotnet build Folio.Database\Folio.Database.sqlproj      # the model, to a .dacpac

npm --prefix Folio.Web test                             # the site
npm --prefix Folio.Web run build                        # types and the bundle
```

The API tests build their own throwaway database from the model scripts and then apply the
migrations, which is what proves a migration still lands a database where the model says it
should be. They **skip** when no SQL Server is reachable; `Folio_REQUIRE_DATABASE_TESTS=1`
turns that skip into a failure, which is what the deploy sets.

## Deploying it

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

### Secrets and variables

| Name | Kind | What it does |
| --- | --- | --- |
| `ACCOUNT_PASSWORD` | secret | The password the account is created with the first time the API meets an empty database. |
| `RECOVERY_CODE` | secret | The word that lets a forgotten password be replaced from the sign-in page. With none set, reset refuses. |
| `WEB_PUBLIC_ORIGIN` | variable | The origin browsers load the site from; the API's CORS allow-list. |
| `SQL_SERVER` | variable | Optional. Defaults to `localhost` — the same box. |
| `DB_NAME` | variable | Optional. Defaults to `Folio`. |
| `ACCOUNT_USERNAME` | variable | Optional. Defaults to `wayne`. |

Nothing secret lives in the repository. The deploy writes the connection string, the CORS
origins and the two secrets into `appsettings.Production.json` on the box on every deploy.

### The box, once — not once per project

IIS and the ASP.NET Core hosting bundle, SQL Server, and a runner. The deploy installs
`sqlpackage` itself if it is missing, and creates the database and grants the runner and
the API's app pool what they need in Windows terms — no SQL login, no password.

The one thing that needs a sysadmin once is creating those logins: the runner account has
to be a sysadmin for that first bootstrap. See the failure message the bootstrap prints if
it is not.

## Licence

MIT — see [LICENSE](LICENSE).
