# Changelog

All notable changes to Clearbook will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [1.2.3] - 2026-04-21

### Changed
- refactor: rename date utility functions and update BudgetItem structure
- Merge pull request #4 from Wayne-Thornberry/morechanges
- Add unit tests for savingsGoalStore, transactionStore, and utility functions

---

## [1.2.2] - 2026-04-21

### Changed
- Merge pull request #4 from Wayne-Thornberry/morechanges
- Add unit tests for savingsGoalStore, transactionStore, and utility functions

---

## [1.2.1] - 2026-04-21

### Changed
- Merge pull request #3 from Wayne-Thornberry/development
- Refactor transactionStore to allow zero opening balances, enhance account styles for better responsiveness and aesthetics, and improve CSV processing to eliminate cross-file duplicates while preserving in-file duplicates.

---

## [1.2.0] - 2026-04-21

### Changed
- Merge branch 'main' of https://github.com/Wayne-Thornberry/P2
- feat(transactions): add locking mechanism for transactions

---

## [1.1.0] - 2026-04-21

### Changed
- refactor: migrate to ES module syntax in update-changelog script
- feat: update workflows and add changelog automation; integrate app versioning in AboutPage

---

## [1.0.0] - 2026-04-19

### Added
- Envelope budgeting with monthly budget items, categories, and assigned amounts
- Transaction log with manual entry, CSV bank import, and duplicate detection
- Auto-categorisation engine with pattern-matched suggestions
- Assign panel — walk through unassigned transactions one at a time or bulk auto-assign
- Savings Goals with manual contributions and linked-account auto-tracking
- Reports — spending summaries, category breakdowns, income vs. expense, per-account balances
- Six UI themes: Light, Dark, Midnight, Forest, Purple, Rose, Slate, Teal
- Full localisation — configurable locale, currency symbol, date format, and number format
- Backup and restore via JSON export/import in Settings
- Global search with keyboard navigation
- Fixed-position pagination navigation arrows in Transaction log
- MIT License

[Unreleased]: https://github.com/Wayne-Thornberry/P2/compare/v1.2.3...HEAD
[1.2.3]: https://github.com/Wayne-Thornberry/P2/compare/v1.2.1...v1.2.3
[1.2.2]: https://github.com/Wayne-Thornberry/P2/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/Wayne-Thornberry/P2/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Wayne-Thornberry/P2/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Wayne-Thornberry/P2/compare/v1.0.20...v1.1.0
[1.0.0]: https://github.com/Wayne-Thornberry/P2/releases/tag/v1.0.0
