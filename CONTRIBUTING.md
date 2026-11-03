# Contributing to Folio

Thanks for your interest in contributing! Here's how to get involved.

---

## Getting Started

1. **Fork** the repository and clone your fork locally.
2. Start everything with `.\start.ps1` — the site and its mock API. No database, no .NET
   build: a local run serves a complete example budget from memory.
3. Make your changes on a new branch: `git checkout -b feat/your-feature-name`

---

## Branch Naming

| Prefix | Use |
|---|---|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `chore/` | Maintenance, dependencies |
| `docs/` | Documentation only |
| `refactor/` | Code restructure with no behaviour change |

---

## Before Submitting a PR

- Run `npm --prefix Folio.Web run typecheck` — all type errors must be resolved.
- Run `npm --prefix Folio.Web run build` — the build must succeed.
- Run `dotnet test Folio.Api.Tests\Folio.Api.Tests.csproj` and `npm --prefix Folio.Web test`.
- Keep changes focused. One concern per PR.

---

## Commit Messages

Use plain, present-tense messages:

```
Add savings goal linked account removal
Fix GlobalSearch currency format
Update pagination arrows to fixed width
```

---

## Reporting Bugs

Open a [Bug Report](https://github.com/Wayne-Thornberry/P2/issues/new?template=bug_report.md).

## Requesting Features

Open a [Feature Request](https://github.com/Wayne-Thornberry/P2/issues/new?template=feature_request.md).

---

## Code Style

- Vue 3 `<script setup>` SFCs with TypeScript.
- Pinia setup stores for all shared state.
- A module's CSS lives with the module, under `Folio.Web/src/modules/<name>/styles/`.
- The browser's copy of the data is a cache: it is read and written through
  `src/modules/<name>/workspace.ts`, never with `localStorage` directly.
- On the API side, a table is read and written through the module's own service; a store
  never talks to SQL Server itself.

The full set of rules is in [AGENTS.md](AGENTS.md).

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
