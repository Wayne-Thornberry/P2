# Modules

One folder per app. The site's router turns a folder into a route, and the API knows the
same app by name under `/api/<name>`.

```
src/modules/
  registry.ts        one line per module: which route, which folder
  folio/             the budget
    index.ts         the route
    FolioView.vue    the app itself, with its own pages and sidebar
    workspace.ts     how its data reaches the API
    components/      its pages and dialogs
    stores/          its Pinia stores
    utils/           its pure logic, and the tests beside it
    styles/          its look
```

## What a module is

- **A route** named after the API module, so the home page can find its title and
  description. `registry.ts` holds the one line that adds it.
- **Its own folder** under `src/modules`, loaded lazily: it ships as its own chunk.
- **Its own state**, in Pinia setup stores. Nothing outside the folder reads it, and it
  reads nothing outside it except `src/shared`.
- **Tests beside its logic** (`*.test.ts`), run by `npm test`.

## Adding one

1. API: a folder under `Folio.Api/Modules`, a class implementing
   [IFolioModule](../../../../Folio.Api/Modules/IFolioModule.cs), and its tables in
   `Folio.Database`.
2. Site: a folder here with its page, an `index.ts` exporting its route, and a line in
   `registry.ts`.
3. Tests: a class in `Folio.Api.Tests`, and a `*.test.ts` beside the site's logic.

Nothing in `start.ps1`, the build or the deploy changes when a module is added.

## Folio is one module, not many

The budget, the accounts, the reports and the calculator all read the same transactions,
so they are one app with its own navigation inside it rather than four modules passing the
same rows between each other. A second app — a different subject entirely — belongs in its
own folder beside `folio/`.
