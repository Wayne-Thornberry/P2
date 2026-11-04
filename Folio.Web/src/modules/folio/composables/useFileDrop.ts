import { ref } from 'vue'
import { readStatements } from './useStatement'
import type { StatementAnswer } from './useStatement'

const isDraggingOver        = ref(false)
const csvDialogVisible      = ref(false)
const pendingCsvFiles       = ref<Array<{ text: string; fileName: string }>>([])
const pendingStatement      = ref<StatementAnswer | null>(null)
const readingStatement      = ref(false)
const statementError        = ref('')
const backupDropVisible     = ref(false)
const pendingBackupJson     = ref('')
let dragCounter = 0

function onDragEnter(e: DragEvent): void {
  e.preventDefault()
  dragCounter++
  if (e.dataTransfer?.types.includes('Files')) {
    isDraggingOver.value = true
  }
}

function onDragOver(e: DragEvent): void {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(): void {
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    isDraggingOver.value = false
  }
}

/**
 * A statement, dropped as the bank printed it.
 *
 * The API answers with the transactions and the balances either end, which is the same
 * shape a parsed CSV has, so the dialog that previews an import is the same dialog.
 */
async function readDroppedStatements(files: File[]): Promise<void> {
  statementError.value = ''
  readingStatement.value = true

  try {
    pendingStatement.value = await readStatements(files)
    pendingCsvFiles.value  = []
    csvDialogVisible.value = true
  } catch (error) {
    statementError.value = error instanceof Error ? error.message : 'That statement could not be read.'
  } finally {
    readingStatement.value = false
  }
}

function onDrop(e: DragEvent): void {
  e.preventDefault()
  dragCounter = 0
  isDraggingOver.value = false

  const files = [...(e.dataTransfer?.files ?? [])]

  // A statement PDF is read by the API, because a PDF is a layout rather than a file of rows.
  const statements = files.filter(f => f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf')

  if (statements.length > 0) {
    void readDroppedStatements(statements)
    return
  }

  // Detect JSON backup files
  const jsonFiles = files.filter(f => f.name.toLowerCase().endsWith('.json'))
  if (jsonFiles.length > 0) {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      if (text) {
        pendingBackupJson.value = text
        backupDropVisible.value = true
      }
    }
    reader.readAsText(jsonFiles[0])
    return
  }

  const csvFiles = files.filter(f =>
    f.name.toLowerCase().endsWith('.csv') ||
    f.type === 'text/csv' ||
    f.type === 'application/vnd.ms-excel'
  )

  if (csvFiles.length === 0) return

  const collected: Array<{ text: string; fileName: string }> = []
  let remaining = csvFiles.length

  for (const file of csvFiles) {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      if (text) collected.push({ text, fileName: file.name })
      if (--remaining === 0) {
        pendingStatement.value = null
        pendingCsvFiles.value  = collected
        csvDialogVisible.value = true
      }
    }
    reader.readAsText(file)
  }
}

/** Closes the import dialog and forgets the files it was opened with. */
function closeImportDialog(): void {
  csvDialogVisible.value = false
  pendingCsvFiles.value  = []
  pendingStatement.value = null
}

export function useFileDrop() {
  return {
    isDraggingOver,
    csvDialogVisible,
    pendingCsvFiles,
    pendingStatement,
    readingStatement,
    statementError,
    backupDropVisible,
    pendingBackupJson,
    closeImportDialog,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  }
}
