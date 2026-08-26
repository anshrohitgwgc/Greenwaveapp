/**
 * A tiny online/offline store.
 *
 * Two consumers need this and they need it differently: React components want
 * to re-render (`useOnline`), and the mutation layer needs a synchronous
 * answer at the moment a driver taps a button (`isOnline`). One store serves
 * both, so they can never disagree.
 */

import { useSyncExternalStore } from 'react';

let online = true;
const listeners = new Set<() => void>();

export function setOnline(next: boolean): void {
  if (next === online) return;
  online = next;
  listeners.forEach((listener) => listener());
}

/** Synchronous — safe to call inside a mutation function. */
export function isOnline(): boolean {
  return online;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => online,
    () => true, // server/initial snapshot — assume connected until told otherwise
  );
}
