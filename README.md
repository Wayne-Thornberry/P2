# Clearbook

> A privacy-first, offline personal finance tracker that keeps your finances clear.

[![CI](https://github.com/Wayne-Thornberry/P2/actions/workflows/ci.yml/badge.svg)](https://github.com/Wayne-Thornberry/P2/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](CHANGELOG.md)

---

## What is Clearbook?

Clearbook is a **100% local**, no-account, no-server personal finance app that runs entirely in your browser. Your data lives in `localStorage` and never leaves your device unless you export it yourself.

It follows the **envelope budgeting** philosophy — define budget categories each month, assign money to them, and track exactly where it goes. On top of that it adds full account management, savings goals, loan and savings-account tracking, multi-tab reports, and global search — all fully offline.

---

## Features

### Budgeting
- **Envelope budgeting** — monthly budget items with assigned amounts and running totals
- **Budget template** — define categories once, apply them to every new month
- **Assign panel** — walk through unassigned transactions one at a time, or bulk auto-assign

### Transactions
- **Transaction log** — manual entry or CSV bank import with duplicate detection
- **Auto-categorisation** — pattern-matched suggestions based on transaction name history
- **Filters** — filter by month, account, budget item, type, or name
- **CSV adapters** — BOI, Revolut, SEB, Kandus Banking, and a generic fallback format

### Accounts
- **Asset & Liability types** — liabilities are excluded from the budget total automatically
- **Reconcile** — step through transactions to reconcile a running balance
- **Archive** — retire old accounts while preserving their history
- **Sparkbar history** — per-account 6-month bar chart; click any bar to jump to that month in Reports
- **Linked navigation** — click linked goals or finance records on the account card to jump directly to them

### Savings & Finance
- **Savings Goals** — set targets, log contributions, link to an account for auto-tracking
- **Loans** — amortisation schedule, balance projection chart, linked account tracking
- **Savings accounts** — balance growth chart, interest tracking

### Reports
- **Overview** — all-time totals, trends, and year-over-year charts, filterable by account
- **Breakdown** — month-by-month or date-range spending, per-account filtering
- **Items** — budget category analysis across any time range
- **Finance** — loan and savings projection charts

### UX
- **Global search** — find any transaction instantly from the header bar
- **8 themes** — Light, Dark, Midnight, Forest, Purple, Rose, Slate, Teal
- **Multi-country** — separate data per country, full locale/currency/date format support
- **FX conversion** — display amounts in a second currency at a custom rate (display-only)
- **Export / Import** — full JSON backup; drag-and-drop anywhere to restore
- **Drag-and-drop CSV** — drop a bank export anywhere on the Transactions page to import

---

## Tech Stack

| Library | Role |
|---|---|
| [Vue 3](https://vuejs.org/) | UI framework — Composition API + `<script setup>` |
| [TypeScript](https://www.typescriptlang.org/) | Strict typing throughout |
| [Vite](https://vite.dev/) | Dev server and build tool |
| [Pinia](https://pinia.vuejs.org/) | State management — setup-store style |
| [PrimeVue 4](https://primevue.org/) | UI component library (Aura preset) |
| [Tailwind CSS v4](https://tailwindcss.com/) | Utility-first styling |
| [Chart.js](https://www.chartjs.org/) | Bar, line, doughnut, and area charts |
| [Vitest](https://vitest.dev/) | Unit tests (happy-dom environment) |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm (comes with Node)

### Install & Run

```bash
# Clone the repo
git clone https://github.com/Wayne-Thornberry/P2.git
cd P2

# Install dependencies
npm install

# Start the dev server (http://127.0.0.1:3000)
npm run dev
```

### Build for Production

```bash
npm run build
# Output is in dist/
```

### Preview Production Build

```bash
npm run preview
```

### Tests

```bash
npm test
# or
npx vitest run
```

### Type Check

```bash
npm run typecheck
```

---

## Releases

Releases are automated via GitHub Actions. Push a version tag to trigger a build and publish a GitHub Release:

```bash
git tag v1.0.1
git push origin v1.0.1
```

See [CHANGELOG.md](CHANGELOG.md) for release history.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE) © 2026 Wayne-Thornberry


---

## What is Clearbook?

Clearbook is a **100% local**, no-account, no-server personal finance app that runs entirely in your browser. Your data lives in `localStorage` and never leaves your device unless you export it yourself.

It follows the **envelope budgeting** philosophy — define budget categories each month, assign money to them, and track exactly where it goes.

---

## Features

- **Envelope budgeting** — monthly budget items with assigned amounts and running totals
- **Transaction log** — manual entry or CSV bank import with duplicate detection
- **Auto-categorisation** — pattern-matched suggestions based on transaction name history
- **Assign panel** — walk through unassigned transactions one at a time, or bulk auto-assign
- **Savings Goals** — set targets, track contributions, link to an account for auto-tracking
- **Reports** — spending summaries, category breakdowns, income vs. expense, per-account balances
- **6 themes** — Light, Dark, Midnight, Forest, Purple, Rose, Slate, and Teal
- **Localisation** — configurable locale, currency symbol, date format, and number format
- **Backup / Restore** — full JSON export and import via Settings

---

## Tech Stack

| Library | Role |
|---|---|
| [Vue 3](https://vuejs.org/) | UI framework — Composition API + `<script setup>` |
| [TypeScript](https://www.typescriptlang.org/) | Strict typing throughout |
| [Vite](https://vite.dev/) | Dev server and build tool |
| [Pinia](https://pinia.vuejs.org/) | State management |
| [PrimeVue 4](https://primevue.org/) | UI component library (Aura preset) |
| [Tailwind CSS v4](https://tailwindcss.com/) | Utility-first styling |
| [Chart.js](https://www.chartjs.org/) | Reports charts |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm (comes with Node)

### Install & Run

```bash
# Clone the repo
git clone https://github.com/Wayne-Thornberry/P2.git
cd P2

# Install dependencies
npm install

# Start the dev server (http://127.0.0.1:3000)
npm run dev
```

### Build for Production

```bash
npm run build
# Output is in dist/
```

### Preview Production Build

```bash
npm run preview
```

### Type Check

```bash
npm run typecheck
```

---

## Releases

Releases are automated via GitHub Actions. Push a version tag to trigger a build and publish a GitHub Release:

```bash
git tag v1.0.1
git push origin v1.0.1
```

See [CHANGELOG.md](CHANGELOG.md) for release history.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE) © 2026 Wayne-Thornberry
