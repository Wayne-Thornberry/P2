<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useTemplateStore } from '../stores/templateStore'
import { useBudgetStore } from '../stores/budgetStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useMoneyInput } from '../composables/useMoneyInput'
import type { BudgetItem, BudgetItemDef } from '../types/budget'

const store       = useTemplateStore()
const budgetStore = useBudgetStore()
const settings    = useSettingsStore()

function formatMoney(v: number): string { return settings.formatMoney(v) }

const { moneyFocus, moneyBlur } = useMoneyInput()

// ── Inline editing ─────────────────────────────────────────────
type ItemDraft = { name: string; assigned: string }
const editingId  = ref<number | null>(null)
const editDraft  = ref<ItemDraft>({ name: '', assigned: '' })

function startEdit(item: BudgetItem): void {
  editingId.value = item.id
  editDraft.value = { name: item.name, assigned: String(item.assigned) }
}

function commitEdit(item: BudgetItem): void {
  if (editingId.value !== item.id) return
  const name = editDraft.value.name.trim()
  if (!name) { cancelEdit(); return }
  store.updateItem({ ...item, name, assigned: Math.max(0, parseFloat(editDraft.value.assigned) || 0) })
  editingId.value = null
}

function cancelEdit(): void {
  editingId.value = null
}

function onEditFocusOut(e: FocusEvent, item: BudgetItem): void {
  const rel = e.relatedTarget as HTMLElement | null
  if (!rel?.closest('.tpl-edit-row')) commitEdit(item)
}

// ── Category rename ────────────────────────────────────────────
const renamingCat  = ref<string | null>(null)
const renameDraft  = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

async function startRenameCategory(cat: string): Promise<void> {
  renamingCat.value = cat
  renameDraft.value = cat
  await nextTick()
  renameInputRef.value?.select()
}

function commitRenameCategory(): void {
  if (renamingCat.value) store.renameCategory(renamingCat.value, renameDraft.value)
  renamingCat.value = null
}

function cancelRename(): void { renamingCat.value = null }

// ── Add item ───────────────────────────────────────────────────
const addingCat       = ref<string | null>(null)
const addMode         = ref<'select' | 'create'>('select')
const addDraft        = ref<ItemDraft>({ name: '', assigned: '' })
const addNameInputRef = ref<HTMLInputElement[]>([])
const addSelectRef    = ref<HTMLSelectElement[]>([])

/** Global items not yet in the template */
const availableForCategory = computed(() => {
  const inTpl = new Set(store.entries.map(e => e.itemId))
  return budgetStore.globalItems.filter(i => !inTpl.has(i.id))
})

async function startAddItem(cat: string): Promise<void> {
  cancelEdit()
  addingCat.value = cat
  addDraft.value  = { name: '', assigned: '0' }
  addMode.value   = availableForCategory.value.length > 0 ? 'select' : 'create'
  await nextTick()
  if (addMode.value === 'select') addSelectRef.value[0]?.focus()
  else addNameInputRef.value[0]?.focus()
}

function onSelectExistingForTemplate(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (!value) return
  if (value === '__new__') {
    addMode.value = 'create'
    nextTick(() => addNameInputRef.value[0]?.focus())
    ;(event.target as HTMLSelectElement).value = ''
    return
  }
  store.addExistingItem(parseInt(value), addingCat.value!, 0)
  addingCat.value = null
}

function commitAddItem(): void {
  const name = addDraft.value.name.trim()
  if (name && addingCat.value) {
    store.addItem(name, addingCat.value, Math.max(0, parseFloat(addDraft.value.assigned) || 0))
  }
  addingCat.value = null
}

function cancelAdd(): void { addingCat.value = null }

function onAddFocusOut(e: FocusEvent): void {
  const rel = e.relatedTarget as HTMLElement | null
  if (!rel?.closest('.tpl-add-row')) commitAddItem()
}

// ── Add category ───────────────────────────────────────────────
const addingCategory     = ref(false)
const newCategoryName    = ref('')
const newCatInputRef     = ref<HTMLInputElement | null>(null)

async function startAddCategory(): Promise<void> {
  addingCategory.value  = true
  newCategoryName.value = ''
  await nextTick()
  newCatInputRef.value?.focus()
}

function commitAddCategory(): void {
  if (newCategoryName.value.trim()) store.addCategory(newCategoryName.value.trim())
  addingCategory.value = false
}

function cancelAddCategory(): void { addingCategory.value = false }

// ── Delete helpers ─────────────────────────────────────────────
function removeItem(id: number): void {
  store.removeItem(id)
  if (editingId.value === id) cancelEdit()
}

function removeCategory(cat: string): void {
  const count = store.itemsInCategory(cat).length
  if (!confirm(`Remove category "${cat}" and all ${count} item${count !== 1 ? 's' : ''} from the template?`)) return
  store.removeCategory(cat)
}

function deleteGlobally(item: BudgetItemDef): void {
  if (!confirm(`Delete "${item.name}" from EVERY month, the template, and unassign all transactions?\nThis cannot be undone.`)) return
  budgetStore.deleteItemGlobally(item.id)
}

// ── Right panel: create global item ──────────────────────────
const newPanelName    = ref('')
const newPanelError   = ref('')
const newPanelInputRef = ref<HTMLInputElement | null>(null)

function commitNewPanelItem(): void {
  const name = newPanelName.value.trim()
  if (!name) return
  const dup = budgetStore.globalItems.some(i => i.name.toLowerCase() === name.toLowerCase())
  if (dup) { newPanelError.value = 'Already exists'; return }
  budgetStore.getOrCreateGlobalItem(name)
  newPanelName.value  = ''
  newPanelError.value = ''
  nextTick(() => newPanelInputRef.value?.focus())
}

// ── Reset ──────────────────────────────────────────────────────
function handleReset(): void {
  if (!confirm('Reset template to built-in defaults? Any custom changes will be lost.')) return
  store.resetToDefault()
}

// ── Category total ─────────────────────────────────────────────
function catTotal(cat: string): number {
  return store.itemsInCategory(cat).reduce((s, i) => s + i.assigned, 0)
}

// ── Grand total ────────────────────────────────────────────────
function grandTotal(): number {
  return store.items.reduce((s, i) => s + i.assigned, 0)
}
</script>

<template>
  <div class="tpl-page">

    <!-- Page header -->
    <div class="tpl-header">
      <div>
        <h1 class="tpl-title">Budget Template</h1>
        <p class="tpl-subtitle">Define the default categories and amounts applied when you populate a new month.</p>
      </div>
      <div class="tpl-header-actions">
        <button class="tpl-reset-btn" @click="handleReset">
          <i class="pi pi-undo" /> Reset to defaults
        </button>
      </div>
    </div>

    <!-- Two-column body -->
    <div class="tpl-body">

      <!-- Left: template editor -->
      <div class="tpl-editor">

        <!-- Category sections -->
        <div
          v-for="cat in store.categories"
          :key="cat"
          class="tpl-section"
        >
          <!-- Category heading -->
          <div class="tpl-cat-header">
            <input
              v-if="renamingCat === cat"
              ref="renameInputRef"
              v-model="renameDraft"
              class="tpl-cat-name-input"
              @keydown.enter.prevent="commitRenameCategory"
              @keydown.escape.prevent="cancelRename"
              @blur="commitRenameCategory"
            />
            <button v-else class="tpl-cat-name" @dblclick="startRenameCategory(cat)" title="Double-click to rename">
              {{ cat }}
            </button>
            <span class="tpl-cat-total">{{ formatMoney(catTotal(cat)) }}</span>
            <button class="tpl-cat-add-btn" @click="startAddItem(cat)" title="Add item">
              <i class="pi pi-plus" />
            </button>
            <button class="tpl-cat-del-btn" @click="removeCategory(cat)" title="Remove category">
              <i class="pi pi-trash" />
            </button>
          </div>

          <!-- Items table -->
          <table class="tpl-table">
            <thead>
              <tr>
                <th class="tpl-th-name">Item</th>
                <th class="tpl-th-amount">Default Amount</th>
                <th class="tpl-th-action"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="item in store.itemsInCategory(cat)" :key="item.id">
                <!-- Edit row -->
                <tr
                  v-if="editingId === item.id"
                  class="tpl-edit-row"
                  @focusout="onEditFocusOut($event, item)"
                  @keydown.escape.prevent="cancelEdit"
                >
                  <td>
                    <input type="text" v-model="editDraft.name" class="tpl-input" @keydown.enter.prevent="commitEdit(item)" />
                  </td>
                  <td class="tpl-td-amount">
                    <input type="text" inputmode="decimal" v-model="editDraft.assigned" class="tpl-input tpl-input-amount" @focus="moneyFocus" @blur="moneyBlur" @keydown.enter.prevent="commitEdit(item)" />
                  </td>
                  <td class="tpl-td-action">
                    <button class="tpl-del-btn" @click.stop="removeItem(item.id)" title="Remove from template">
                      <i class="pi pi-times" />
                    </button>
                  </td>
                </tr>
                <!-- Display row -->
                <tr v-else class="tpl-row" @click="startEdit(item)" title="Click to edit">
                  <td class="tpl-td-name">{{ item.name }}</td>
                  <td class="tpl-td-amount">{{ formatMoney(item.assigned) }}</td>
                  <td class="tpl-td-action">
                    <button class="tpl-del-btn" @click.stop="removeItem(item.id)" title="Remove from template">
                      <i class="pi pi-times" />
                    </button>
                  </td>
                </tr>
              </template>

              <!-- Add item row -->
              <tr v-if="addingCat === cat" class="tpl-add-row" @focusout="onAddFocusOut" @keydown.escape.prevent="cancelAdd">
                <td colspan="3">
                  <!-- Select existing -->
                  <template v-if="addMode === 'select'">
                    <select
                      ref="addSelectRef"
                      class="tpl-add-select"
                      @change="onSelectExistingForTemplate($event)"
                      @keydown.escape="cancelAdd"
                    >
                      <option value="">— Select existing item —</option>
                      <option v-for="item in availableForCategory" :key="item.id" :value="item.id">
                        {{ item.name }}
                      </option>
                      <option value="__new__">+ Create new item…</option>
                    </select>
                  </template>
                  <!-- Create new -->
                  <template v-else>
                    <div class="tpl-add-create-row">
                      <input
                        ref="addNameInputRef"
                        type="text"
                        v-model="addDraft.name"
                        class="tpl-input"
                        placeholder="Item name…"
                        @keydown.enter.prevent="commitAddItem"
                      />
                      <input
                        type="text"
                        inputmode="decimal"
                        v-model="addDraft.assigned"
                        class="tpl-input tpl-input-amount"
                        placeholder="0.00"
                        @focus="moneyFocus"
                        @blur="moneyBlur"
                        @keydown.enter.prevent="commitAddItem"
                      />
                    </div>
                  </template>
                </td>
              </tr>

              <!-- Empty category -->
              <tr v-if="store.itemsInCategory(cat).length === 0 && addingCat !== cat">
                <td colspan="3" class="tpl-empty-cat">No items — <button class="tpl-inline-add" @click="startAddItem(cat)">add one</button></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Add category -->
        <div class="tpl-add-category">
          <template v-if="addingCategory">
            <input
              ref="newCatInputRef"
              v-model="newCategoryName"
              class="tpl-input tpl-cat-input"
              placeholder="Category name…"
              @keydown.enter.prevent="commitAddCategory"
              @keydown.escape.prevent="cancelAddCategory"
              @blur="commitAddCategory"
            />
          </template>
          <button v-else class="tpl-add-cat-btn" @click="startAddCategory">
            <i class="pi pi-plus" /> Add Category
          </button>
        </div>

        <!-- Grand total footer -->
        <div class="tpl-footer">
          <span class="tpl-footer-label">Total assigned per month</span>
          <span class="tpl-footer-total">{{ formatMoney(grandTotal()) }}</span>
        </div>

      </div><!-- /tpl-editor -->

      <!-- Right: all global items -->
      <aside class="tpl-items-panel">
        <div class="tpl-items-panel-header">
          <span class="tpl-items-panel-title">All Budget Items</span>
          <span class="tpl-items-panel-count">{{ budgetStore.globalItems.length }}</span>
        </div>
        <p class="tpl-items-panel-hint">Items exist globally. Deleting here removes them from every month and template.</p>

        <!-- Add item input -->
        <div class="tpl-panel-add">
          <input
            ref="newPanelInputRef"
            type="text"
            v-model="newPanelName"
            class="tpl-panel-add-input"
            placeholder="New item name…"
            @keydown.enter.prevent="commitNewPanelItem"
            @keydown.escape="newPanelName = ''; newPanelError = ''"
            @input="newPanelError = ''"
          />
          <button class="tpl-panel-add-btn" @click="commitNewPanelItem" title="Add item">
            <i class="pi pi-plus" />
          </button>
        </div>
        <div v-if="newPanelError" class="tpl-panel-add-error">{{ newPanelError }}</div>

        <div v-if="budgetStore.globalItems.length === 0" class="tpl-items-empty">
          No items yet. Add items via the template or any budget month.
        </div>

        <div
          v-for="item in [...budgetStore.globalItems].sort((a, b) => a.name.localeCompare(b.name))"
          :key="item.id"
          class="tpl-items-row"
        >
          <span class="tpl-items-name">{{ item.name }}</span>
          <button
            class="tpl-items-del-btn"
            title="Delete globally (removes from all months + template)"
            @click="deleteGlobally(item)"
          >
            <i class="pi pi-trash" />
          </button>
        </div>
      </aside>

    </div><!-- /tpl-body -->

  </div>
</template>
