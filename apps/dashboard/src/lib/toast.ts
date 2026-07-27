import { useSyncExternalStore } from 'react';

// Lightweight app-wide toast store (no dependency). pushToast() from anywhere; <Toaster/> renders them.
export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) {
    l();
  }
}

/** Show a toast (auto-dismisses). Returns its id. */
export function pushToast(message: string, kind: ToastKind = 'info'): number {
  const id = nextId++;
  toasts = [...toasts, { id, message, kind }];
  emit();
  setTimeout(() => dismissToast(id), 3500);
  return id;
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
    () => toasts,
  );
}
