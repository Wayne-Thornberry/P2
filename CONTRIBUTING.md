# Contributing to Folio

Thanks for your interest in contributing! Here's how to get involved.

---

## Getting Started

1. **Fork** the repository and clone your fork locally.
2. Install dependencies: `npm install`
3. Start the dev server: `npm run dev`
4. Make your changes on a new branch: `git checkout -b feat/your-feature-name`

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

- Run `npm run typecheck` — all type errors must be resolved.
- Run `npm run build` — the build must succeed.
- Keep changes focused. One concern per PR.
- Update [CHANGELOG.md](CHANGELOG.md) under `[Unreleased]` with a short summary.

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
- Pinia stores for all shared state.
- Scoped CSS in separate files under `src/styles/`.
- No external state management or data-fetching libraries — keep it local.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
