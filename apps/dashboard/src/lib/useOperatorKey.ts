import { useSyncExternalStore } from 'react';

// Single source of truth for the operator host key. It is a SESSION credential: held in sessionStorage
// (browser-only, cleared when the tab closes), never sent to the server. The host private key signs
// `host+jwt`s in-browser. All views read it through useOperatorKey so changing it in Settings updates
// every view at once.

const KEY_STORAGE = 'conduit.operatorHostKey';
const listeners = new Set<() => void>();

function read(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Set the operator host key (empty string clears it). Notifies all subscribers. */
export function setOperatorKey(value: string): void {
  try {
    if (value.trim()) {
      sessionStorage.setItem(KEY_STORAGE, value.trim());
    } else {
      sessionStorage.removeItem(KEY_STORAGE);
    }
  } catch {
    /* sessionStorage unavailable - no-op */
  }
  emit();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** Reactive access to the operator host key, shared across all views. */
export function useOperatorKey(): { key: string; loaded: boolean } {
  const key = useSyncExternalStore(subscribe, read, read);
  return { key, loaded: key.trim().length > 0 };
}
