# CSV Import Pipeline

## Design Principles

1. **CSV is gospel** — within any CSV's date range, every transaction is present, correct, and in order. The CSV is the authoritative source.
2. **Multiple CSVs merge first** — `processMultipleCsvFiles()` deduplicates across files, sorts chronologically, detects inter-CSV gaps, then hands a single merged result to `handleImport()`.
3. **Range-replace when boundaries match** — if both the first and last CSV rows exist in the current data, the entire date range is deleted and replaced with the CSV. This handles re-imports, data drift, and corrections.
4. **Append with gap handling otherwise** — when boundaries don't both exist (backfill, forward extension, first import), rows are appended with count-based dedup, and gap bridges / opening balances keep the running balance in sync.
5. **Opening Balance is always established** — Every account gets an Opening Balance transaction on first import. The balance value is derived from the bank adapter's balance data in the CSV (each bank formats this differently — see individual adapters). If the CSV has no balance information, no OB can be calculated — the user is warned but the import still proceeds.
6. **OB moves backward, never forward** — If imported CSV data pre-dates the existing Opening Balance, the old OB is deleted and a new, earlier one is created from the CSV. The OB always marks the true start of known history.

## The Two Import Paths

```
CSV rows arrive
      │
      ▼
Find first row in existing data? ──No──┐
Find last row in existing data?  ──No──┤
      │                                │
     Yes (both)                        │
      │                                ▼
      ▼                     ┌──────────────────────┐
┌──────────────────┐        │    APPEND / GAP      │
│  RANGE-REPLACE   │        │                      │
│                  │        │ • First import?       │
│  Delete all txs  │        │   → Create OB         │
│  between first & │        │                      │
│  last match dates│        │ • Backfill?           │
│  (inclusive)     │        │   → Replace OB        │
│                  │        │   → Gap bridge        │
│  Insert ALL CSV  │        │                      │
│  rows (no dedup) │        │ • Forward gap?        │
│                  │        │   → Balance Adjust    │
│  Insert inter-CSV│        │                      │
│  gap adjustments │        │ • Count-based dedup   │
│                  │        │   (skip exact dupes)  │
│  Done.           │        │                      │
└──────────────────┘        └──────────────────────┘
```

## Opening Balance Rules

Every account needs to know its starting point. The Opening Balance (OB) is a special transaction that
anchors the account's running balance at the beginning of known history.

| Rule | Detail |
|------|--------|
| **OB created on first import** | When an account has zero transactions and a CSV with balance data is imported, an OB transaction is created. The date is the day before the oldest transaction. The amount comes from the adapter's `getOpeningBalance()`. |
| **OB replaced on backfill** | When imported data is older than the existing OB, the old OB is deleted and a new, earlier one is created from the imported CSV. |
| **OB never moves forward** | Importing newer data never changes the OB. Only importing older data does. |
| **No balance data? No OB** | If the CSV has no balance column (or the adapter can't extract one), the user sees a warning in the dialog. Transactions are still imported, but no OB is created. The running balance will start from zero. |
| **Adapter determines the value** | Each bank adapter implements `getOpeningBalance(rows)` differently — it may use the balance on the first row, the last row, or a calculation. See the adapter source files for specifics. |

## Scenario Reference

| # | What you do | What happens |
|---|-------------|--------------|
| 1 | **First import ever** — drop `march-may.csv` | Append path. No existing data → OB created, all rows inserted. |
| 2 | **Re-import to fix data** — drop same CSV again | Range-replace. First & last rows found → entire range deleted, CSV rows reinserted fresh. Any drift fixed. |
| 3 | **Fragment** — drop `may-only.csv` (already have March-April) | Range-replace if both boundaries exist in data → May range replaced. Otherwise Append with count-based dedup. |
| 4 | **Multiple fragments at once** — drop `march.csv` + `may.csv` | File merger deduplicates across files, detects gap between March and May, creates inter-CSV gap adjustment. Then range-replace: if boundaries found → March-May range replaced, gap adjustment bridges the missing April. |
| 5 | **Import older data** (backfill) — already have May, drop `april.csv` | Append path. Backfill: old OB replaced with earlier one, gap bridge inserted to keep balance synced. |
| 6 | **Import newer data** (forward gap) — already have April, drop `may.csv` with a gap | Append path. Forward gap: Balance Adjustment inserted to bridge the balance. |
| 7 | **Adjacent fragments** — already have April, drop `may.csv` (no gap) | Range-replace or Append. No gap bridge needed — dates are adjacent. |
| 8 | **Overlapping import** — already have March-May, drop `april-only.csv` | Range-replace. April boundaries found → April range replaced. March and May untouched. |
| 9 | **Complete redo** — drop one CSV with full history | Range-replace. First & last rows found → entire history replaced in one operation. |
| 10 | **First import, no balance in CSV** — brand new account, CSV has transactions but no balance column | Dialog shows warning: "No balance data — opening balance cannot be calculated." Import proceeds with transactions only, no OB. |
| 11 | **First import, with balance in CSV** — brand new account, CSV includes balance data (format varies by bank) | OB created from the adapter's `getOpeningBalance()` + `getOpeningDate()`. The OB date is the day before the oldest transaction. |
| 12 | **Backfill pre-dates existing OB** — already have May data + OB at Apr 30, drop `march.csv` that starts Mar 1 | Old OB (Apr 30) deleted. New OB created from CSV at Feb 28 (day before oldest CSV row). Gap bridge inserted between new OB and existing May data to keep balance consistent. |

## Multi-CSV Merging

`processMultipleCsvFiles()` in `csvAdapters.ts` handles:

1. **Parse each file independently** — adapter auto-detection or forced by user selection
2. **Enforce single adapter** — all files must use the same bank adapter
3. **Sort files chronologically** — oldest file first
4. **Cross-file count-based dedup** — overlapping rows across files are eliminated; legitimately repeated transactions within a single file are preserved
5. **Opening balance** — from the chronologically first file
6. **Closing balance** — from the chronologically last file
7. **Inter-CSV gap detection** — if adjacent files have a balance discrepancy, a `GapAdjustment` is created

## File Map

| File | Role |
|------|------|
| `src/components/CsvImportDialog.vue` | UI dialog + `handleImport()` orchestration |
| `src/utils/csvAdapters.ts` | Adapter registry, single-file parsing, multi-file merging |
| `src/utils/csvUtils.ts` | CSV parsing primitives (delimiter detection, line splitting, date parsing) |
| `src/utils/txNameCleaner.ts` | Bank-specific name cleaning + fuzzy merchant matching for auto-assignment |
| `src/utils/date.ts` | Timezone-safe `dayBefore`/`dayAfter` helpers |
| `src/utils/autoCategory.ts` | Keyword→hint dictionary for auto-categorization |
| `src/composables/useCsvDrop.ts` | Drag-and-drop file collection |
| `src/stores/transactionStore.ts` | `bulkAddTransactions` / `bulkDeleteTransactions` / `addOpeningBalance` |
| `src/stores/importHistoryStore.ts` | Records every successful import |
