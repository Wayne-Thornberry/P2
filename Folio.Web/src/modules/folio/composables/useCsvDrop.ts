import { ref } from 'vue'

const isDraggingOver        = ref(false)
const csvDialogVisible      = ref(false)
const pendingCsvFiles       = ref<Array<{ text: string; fileName: string }>>([])
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

function onDrop(e: DragEvent): void {
  e.preventDefault()
  dragCounter = 0
  isDraggingOver.value = false

  const files = [...(e.dataTransfer?.files ?? [])]

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
        pendingCsvFiles.value  = collected
        csvDialogVisible.value = true
      }
    }
    reader.readAsText(file)
  }
}

export function useCsvDrop() {
  return {
    isDraggingOver,
    csvDialogVisible,
    pendingCsvFiles,
    backupDropVisible,
    pendingBackupJson,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  }
}
