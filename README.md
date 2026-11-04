# Folio — a private budget on your own box

Folio is a personal finance app: envelope budgeting, a transaction log that takes a dropped
CSV or a dropped bank statement PDF, accounts, savings goals, loans, reports, a calendar, a
what-if calculator and a financial health score. It follows one person's money across
whatever countries they keep a budget in, and it runs on a single Windows box: IIS serves
the site and the API, and SQL Server sits beside them.

The rules a change has to obey, and the handful that must never be broken, are in
[AGENTS.md](AGENTS.md).

```
                    ┌───────────────────────────────────────┐
  browser ─────────►│  http://box:5420       one IIS site   │
                    │                                       │
                    │  /          redirects to /folio       │
                    │  /folio     the budget                │
                    └──────────────┬────────────────────────┘
                                   │  fetch
                                   │  (cross-origin: the API allows it)
                    ┌──────────────▼────────────────────────┐
                    │  http://box:5423       one IIS site   │
                    │  Folio.Api                            │
                    │    /api/health      is it there?      │
                    │    /api/folio/...   the budget        │
                    └──────────────┬────────────────────────┘
                                   │
                    ┌──────────────▼────────────────────────┐
                    │  SQL Server      database Folio       │
                    │    folio.Transactions, folio.Budget…  │
                    │    keyed on (UserId, Country, Id)     │
                    └───────────────────────────────────────┘
```

## What is where

| Path | What it is |
| --- | --- |
| [Folio.Api](Folio.Api) | The one backend. An area per module under `/api/<module>`, plus `/api/health`. |
| [Folio.Database](Folio.Database) | The schema as an SSDT project: `Schemas/`, `Types/`, `Tables/` are the model, `Scripts/Migrations/` is its numbered history. |
| [Folio.Api.Tests](Folio.Api.Tests) | xUnit. Each test class builds its own throwaway SQL Server database from the same scripts. |
| [Folio.Api/Auth](Folio.Api/Auth) | Accounts: the rules, the hashing, the session, and the filter every budget endpoint sits behind. |
| [Folio.Web](Folio.Web) | The site. One Vue app; a folder per module under [src/modules](Folio.Web/src/modules), and the sign-in under [src/auth](Folio.Web/src/auth). |
| [start.ps1](start.ps1) | Runs the whole thing locally in one window, and owns the local database: it builds it from the model scripts and applies the migrations. |
| [setup.ps1](setup.ps1) | Prepares the box for its first deploy: both sites, both pools, the firewall, the database and its grants, and the runner. Run once, on the server, elevated. |
| [.github/workflows](.github/workflows) | `ci.yml` on a branch or a pull request, `deploy.yml` on `main` and by hand, `release.yml` for tags. |

**One site, one app, a folder per module.** There is no page in front of the budget: `/`
redirects to `/folio`, so opening the site is opening the budget. The route is lazy, so the
app ships as its own JavaScript chunk, while the shared parts — the API client, the styles
— exist once.

A module is one folder with its own pages, state, styles and tests, and the site's route for
it is named after the API's. A second app would be another folder and another line in
[registry.ts](Folio.Web/src/modules/registry.ts); it would also need a way to be chosen,
which is why there is no listing today — there is one app.

## The data

Folio keeps each area of its state as one collection — accounts, transactions, the budget,
the template, goals, finance, the planner, import history — and the site reads and writes
the whole collection.

- **The API is the database's only client.** `GET /api/folio/workspace?country=<id>` reads
  every collection for that country. `PUT /api/folio/<collection>` replaces one of them, in
  a transaction, and is how every change is saved.
- **One table per entity.** A collection maps onto real columns and keys: transactions in
  `folio.Transactions`, the envelope assignments in `folio.BudgetAssignments`, a goal's
  contributions in `folio.SavingsContributions`, and so on. The model is in
  [Tables](Folio.Database/Tables) and the mapping in
  [FolioDbContext](Folio.Api/Data/FolioDbContext.cs).
- **Country is part of the key.** Every table is keyed on `(UserId, Country, Id)`, so the
  budget for Ireland and the budget for Sweden are separate sets of rows, inside an account
  that is separate again from the next person's.
- **The browser keeps a copy.** [workspace.ts](Folio.Web/src/modules/folio/workspace.ts)
  fetches the saved workspace before the app starts and puts it where the stores already
  look; a change is written to the browser immediately and sent to the API shortly after.
  A save that cannot reach the server is retried on the next change rather than lost.

## Where the working out happens

The site holds the data; the **API answers the questions about it**.

- **The health score is the API's.** `GET /api/folio/health?country=<id>&month=<yyyy-mm>`
  reads the saved rows and answers with the score, the grade and the parts it is made of —
  the three-month savings rate, the emergency reserve, the budget adherence, the income
  consistency. The rules are one class,
  [HealthService](Folio.Api/Modules/Folio/HealthService.cs), and its arithmetic is a pure
  function so a test can hand it a fixed day and check the answer.
- **The dashboard's numbers are the API's.** `GET /api/folio/dashboard?country=<id>&month=&budgetMonth=`
  answers with the month's totals, every account's balance, the biggest spending lines, the
  budget's progress and the newest transactions — one answer, so no two cards can disagree.
  [DashboardService](Folio.Api/Modules/Folio/DashboardService.cs) holds the rules, including
  which accounts the budget ignores and which days a billable month owns.
- **The finance summary is the API's.** `GET /api/folio/finance/summary?country=<id>` answers
  what each loan still owes, what it costs a month, when it ends, and what each savings
  account is worth by now. [FinanceService](Folio.Api/Modules/Folio/FinanceService.cs) holds
  the amortisation and compounding, in `double` and rounded the way the browser rounded it,
  so a projection that lands a penny away from the Finance page's own chart cannot happen.
- **The demo budget is the API's.** `POST /api/folio/demo?country=<id>` replaces a country's
  budget with a year of plausible spending for one of three people, and answers with what it
  made. [DemoData](Folio.Api/Modules/Folio/DemoData.cs) holds the rules — which accounts a
  persona has, how often a bill is paid, how much of the budget is really spent — so the
  shape of a stranger's finances is no longer part of the download, and a box with an empty
  database has something to look at.
- **The page renders what it is given.** [useHealthScore](Folio.Web/src/modules/folio/composables/useHealthScore.ts),
  [useDashboard](Folio.Web/src/modules/folio/composables/useDashboard.ts),
  [useFinance](Folio.Web/src/modules/folio/composables/useFinance.ts) and
  [useDemoData](Folio.Web/src/modules/folio/composables/useDemoData.ts) ask once for the whole
  app, and ask again when a save lands — `workspace.ts` counts those — so an edit shows the
  figure after it rather than before.
- **The month is part of the question.** The budget a month is measured against is the one
  on screen, so the site sends it rather than letting the API guess. The dashboard takes two
  months for that reason: the calendar month its cards add up, and the billable month whose
  budget they measure.
- **Reading a statement is the API's.** A bank statement PDF is a picture of a table, not a
  file of rows: whether an amount is money in or out is a question about which column it was
  drawn in. `POST /api/folio/import/statement` is given the words and the boxes they were
  drawn in — [useStatement](Folio.Web/src/modules/folio/composables/useStatement.ts) gets
  those from pdf.js in the browser, when a PDF is dropped — and
  [BankStatement](Folio.Api/Modules/Folio/BankStatement.cs) answers with the transactions,
  the balance each one left behind, the opening balance and any gap between two statements.
  Which headings are the column boundaries, what a date looks like and which lines are the
  statement's own furniture are the bank's rules, so they are not the browser's. It reads
  Bank of Ireland statements today; another bank is another set of headings in that class.

The rest of the arithmetic — the planner's projections, the Finance page's charts, the CSV
adapters — is still in TypeScript, and is being moved into the API in that order. When it
lands, a rule lives in one place: the module's service class. (The statement reader went
first: there was nothing to migrate, and it is the format the PDFs arrive in.)

## Accounts

The budget is somebody's, so there is a sign-in in front of it. `auth.Users` holds one row
per person who may sign in, `auth.Sessions` one per browser that has, and every table in
`folio` carries the account that owns the row — so two people on the same box keep two
budgets, and neither can read the other's.

- **The first account is made from the page.** A box with no accounts has nobody who could
  be handed a password by the box, so the site offers to make the first one; it takes up the
  placeholder row the migration created, which already owns whatever was saved before
  accounts existed. It can only be done once.
- **Every other account is made on the box**, which is deliberate — there is no sign-up
  screen:
  ```powershell
  dotnet run --project Folio.Api -- --add-user margaret
  ```
  It prints a one-time password and stores only its hash. Until that password has been
  replaced, the account opens nothing but the account page.
- **A PIN is the way back in.** Six digits, set from the account page, replaces a forgotten
  password. Wrong ones are counted, and the fifth buys a five-minute wait.
- **The cookie cannot be read by a script.** It is HttpOnly, holds a random token, and the
  table keeps only the token's SHA-256 — so a copy of the table is not a set of working
  sessions. Changing a password signs every other browser out.

The rules are [AccountRules](Folio.Api/Auth/AccountRules.cs) and
[SecretHasher](Folio.Api/Auth/SecretHasher.cs) on the API; the site's copy in
[rules.ts](Folio.Web/src/auth/rules.ts) only lets a form say what is wrong without a round
trip.

## The AI

Two things in Folio ask DeepSeek, and both are on a button because both cost a call and take
a moment.

**The report** — Reports → *AI Report* — reads the last 6, 12, 24 or 36 months, for every
account or the ones picked, and writes what the numbers mean: the headline, what stands out,
the habits and rhythms, the risks, and what to do about them. Underneath it are the figures
it was written from: money in and out, savings rate, every month, every item, the biggest
payees, what repeats, what is over budget.

**The categorising** — Transactions → *AI categorize* — looks at the selected transactions
(or all of them) and proposes the budget item each one belongs to, from its name and notes.
It prefers an item that already exists, matched however it is spelt, and only invents one
when nothing fits — at most eight, named in the proposal before anything is created. Nothing
is written until you press Apply, and applying goes through the stores, so it is saved the
way every other edit is.

**What the AI is not asked to do.** It never adds up your money. Every figure in a report is
worked out by the API from the saved rows — that is the part with tests that need no model —
and the model is given those numbers and asked to read them. A model asked to total a year of
transactions would be a model guessing at arithmetic.

**The key.** It lives in the `DEEPSEEK_API_KEY` repository secret, which the deploy writes
into the API's appsettings.Production.json. For a local run, put it in the environment:

```powershell
$env:DEEPSEEK_API_KEY = 'sk-…'
.\start.ps1
```

With no key, neither page shows its button and both endpoints answer 503: nothing is broken,
there is simply no AI. The mock API in `-Mock` answers both of them itself, so the pages can
be worked on with no key, no network and no bill.

## Running it locally

Requirements: .NET 8 SDK, Node 22+, SQL Server Express LocalDB (or a SQL Server to point
at), and PowerShell. No Java, and no `sqlpackage` — that is only installed on the box, by
the deploy.

```powershell
.\start.ps1            # LocalDB, with the real API  → http://127.0.0.1:5420
.\start.ps1 -Rebuild   # the same, but drop the database and rebuild it from the model
.\start.ps1 -Mock      # no API, no database: the site's own fake API
.\start.ps1 -Dev       # a shared database from appsettings.Development.json
```

The first run creates the LocalDB instance `Folio` and builds the database from the model
scripts. After that a run only applies `Scripts/Migrations`, so a new migration reaches your
database; `-Rebuild` is how you start over. Two processes start: the API and the site — one
each, however many apps there are.

`-Dev` reads `ConnectionStrings:Default` from `Folio.Api\appsettings.Development.json`,
which is gitignored because a real box needs a login. Copy
[appsettings.Development.example.json](Folio.Api/appsettings.Development.example.json) and
fill it in. Nothing else has to be pointed anywhere.

### The ports

| Port | What |
| --- | --- |
| 5420 | The site's dev server, and the site's port in IIS |
| 5421 | The API while developing |
| 5423 | The API in IIS (baked into the build as `VITE_API_PORT`) |
| 5490 | The site's fake API (`-Mock`, or `npm run mock`) |

A port is changed where it is used: the site's and the dev proxy's in
[vite.config.ts](Folio.Web/vite.config.ts), the deployed pair in
[deploy.yml](.github/workflows/deploy.yml), and the local pair in [start.ps1](start.ps1).

### Without the launcher

```powershell
npm --prefix Folio.Web install
npm --prefix Folio.Web test
npm --prefix Folio.Web build

dotnet build Folio.Database\Folio.Database.sqlproj -c Release    # the model, to a .dacpac
dotnet test Folio.Api.Tests\Folio.Api.Tests.csproj
```

Everything else can be run directly. The exception is the local database: it is built from
the model scripts by `start.ps1`, which is also the only thing that knows which of the four
modes you asked for, so a laptop's database comes from `.\start.ps1` (`-Rebuild` throws it
away and builds it again). The box's database is `setup.ps1` and `sqlpackage`.

### The mock

`.\start.ps1 -Mock` starts [Folio.Web/mocks/server.mjs](Folio.Web/mocks/server.mjs), which
answers the same paths as the API with the same shapes, including the
`{ "error": "…" }` body a refusal carries; the data it serves comes from
[seed.mjs](Folio.Web/mocks/seed.mjs) beside it. It holds a complete example budget in
memory — three months of transactions, four accounts, two savings goals, a loan, a planner
scenario and an import history — and signs you in as `wayne` / `mock`. Changes are live and
vanish when you stop it.

Because the site cannot tell the two apart, everything you can do against the real API you
can do here with no database at all. A statement PDF can be dropped on the page in this
mode too: the mock applies the same reading rules as
[BankStatement](Folio.Api/Modules/Folio/BankStatement.cs), so the import that works locally
is the import that works on the box.

## Tests

```powershell
dotnet test Folio.Api.Tests\Folio.Api.Tests.csproj      # API and database
dotnet build Folio.Database\Folio.Database.sqlproj      # the model, to a .dacpac

npm --prefix Folio.Web test                             # the site
npm --prefix Folio.Web run build                        # types and the bundle
```

The API tests build their own throwaway database from the model scripts and then apply the
migrations, which is what proves a migration still lands a database where the model says it
should be. They **skip** when no SQL Server is reachable — a laptop without LocalDB, or one
whose `Folio_TEST_SQL_SERVER` points at nothing — and `Folio_REQUIRE_DATABASE_TESTS=1` turns
that skip into a failure, which is what the deploy sets.

**The mock is held to the API's answers.** `MockParityTests` starts `Folio.Web/mocks/server.mjs`
as a child process, reads its example budget, writes it into a real database through the
same endpoints the site uses, and then asks both sides the same question: the workspace, the
health score, the dashboard and the finance summary have to agree, field for field. Without
it, every sum the API works out is written twice and the mock's copy is the one nobody
notices drifting — the site would look right all day and be wrong on the box. Those tests
need node as well as SQL Server, and skip when either is missing.

## Deploying it

Two workflows matter:

- **`ci.yml`** — on pull requests, and on pushes to any branch but `main`: a push to `main`
  is the deploy's business, and the deploy runs both of these jobs itself. Builds the
  database model and runs the API tests on Windows, tests and builds the site on Ubuntu.
  Database tests run when a SQL Server is available and are reported as skipped when not.
- **`deploy.yml`** — on push to `main`, or by hand with a `deployType` of `full`,
  `apiOnly`, `sitesOnly` or `dbOnly`. Runs on a **self-hosted runner on the box**, which
  builds in place and copies into the folders IIS already serves — `C:\Program
  Files\FolioWeb` and `C:\Program Files\FolioApi`. Nothing is shipped between machines.

Order of a deploy: check the box is set up (a site, a pool, a folder or the database that is
not there means [setup.ps1](setup.ps1) has never run, so the deploy says that instead of
copying into a folder nothing serves) → run the tests, before anything is stopped, so a
failure leaves the running sites alone → build the API, the model and the site → stop the
app pools → copy the site → copy the API and write its `appsettings.Production.json` →
apply the migrations and publish the model with `sqlpackage` → start the pools → smoke-test
the API's `/api/health` and the site's `/` → clean up.

Nothing is created by the deploy. The two IIS sites it publishes onto, and the database the
API reads, are made once by [setup.ps1](setup.ps1):

| Site | Serves | Port |
| --- | --- | --- |
| `Folio` | the site, from `C:\Program Files\FolioWeb` | 5420 |
| `FolioApi` | the API, from `C:\Program Files\FolioApi` | 5423 |

### A new project in two steps

1. **On the box**, elevated, in a clone of the repository: `.\setup.ps1`. It asks for the
   repository and a registration token from Settings → Actions → Runners → New self-hosted
   runner, and makes the folders, both app pools, both sites, the firewall rules, the
   database and its Windows grants. `.\setup.ps1 -Check` reports what is missing and changes
   nothing, which is the thing to run when a deploy says something is not there.
2. **Set `WEB_PUBLIC_ORIGIN`** to where browsers load the site from, e.g.
   `http://<box>:5420`. The API allows that origin through CORS. Anything on the home
   network — `localhost`, `127.0.0.1`, `[::1]`, `10.*`, `192.168.*`, `172.16-31.*` — is
   allowed without being named, because a box is reached by all of them at different times;
   the rule is in [Origins.cs](Folio.Api/Http/Origins.cs) and its tests say exactly which
   addresses it means.

Push, and run *Deploy to Production* once by hand. The box is already made; the deploy
publishes onto it.

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
`sqlpackage` itself if it is missing; [setup.ps1](setup.ps1) makes the database and grants
the runner and the API's app pool what they need in Windows terms — no SQL login, no
password.

The grants are made twice on purpose: once by `setup.ps1` when the database is created, and
again straight after every publish. `sqlpackage` runs with `DropObjectsNotInSource`, which is
what actually drops a column the model no longer has — and it drops a database user the
project does not describe too, which is both of them. Without the second pass the API loses
its own user and answers 503 on a database that is perfectly there.

Creating a login needs a sysadmin, and nothing can promote itself: `setup.ps1` has to run as
an account that is one on the instance — usually the account that installed SQL Server. It
then makes the runner a `dbcreator` itself, so the tests can build their own databases.

## Licence

MIT — see [LICENSE](LICENSE).
