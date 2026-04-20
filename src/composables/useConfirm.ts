import { ref, shallowRef } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (result: boolean) => void
}

const pending = shallowRef<PendingConfirm | null>(null)

export function useConfirmDialog() {
  return { pending }
}

export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      pending.value = { options, resolve }
    })
  }

  return { confirm }
}
