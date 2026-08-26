/**
 * Connectivity watcher and queue drainer.
 *
 * Mount this once, inside the QueryClientProvider. It:
 *   - loads the persisted write queue on start
 *   - tracks whether the device is actually online
 *   - drains the queue, in order, the moment the connection returns
 *   - refreshes the cache afterwards so the UI shows server truth
 *
 * "Online" here means *reachable*, not "wifi icon showing". NetInfo's
 * `isInternetReachable` is what distinguishes a yard wifi network with no
 * uplink from a real connection, which is exactly the case that bites drivers.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { isOnline, setOnline, useOnline } from './network';
import {
  dismissFailures,
  failedEntries,
  flushQueue,
  loadQueue,
  pendingEntries,
  subscribeQueue,
  type QueueEntry,
  type QueueFailure,
} from './queue';

interface OfflineValue {
  online: boolean;
  pending: QueueEntry[];
  failures: QueueFailure[];
  /** Try to send everything now. Safe to call when already online. */
  sync: () => Promise<void>;
  syncing: boolean;
  clearFailures: () => Promise<void>;
}

const OfflineContext = createContext<OfflineValue>({
  online: true,
  pending: [],
  failures: [],
  sync: async () => {},
  syncing: false,
  clearFailures: async () => {},
});

export function useOffline(): OfflineValue {
  return useContext(OfflineContext);
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const client = useQueryClient();
  const online = useOnline();

  const [pending, setPending] = useState<QueueEntry[]>([]);
  const [failures, setFailures] = useState<QueueFailure[]>([]);
  const [syncing, setSyncing] = useState(false);
  const wasOnline = useRef(true);

  // Mirror queue state into React state so screens re-render.
  useEffect(() => {
    const read = () => {
      setPending([...pendingEntries()]);
      setFailures([...failedEntries()]);
    };
    const unsubscribe = subscribeQueue(read);
    void loadQueue().then(read);
    return unsubscribe;
  }, []);

  const sync = useCallback(async () => {
    if (!isOnline() || pendingEntries().length === 0) return;
    setSyncing(true);
    try {
      const result = await flushQueue(new Date().toISOString());
      if (result.sent > 0) {
        // Replace optimistic rows with whatever the server actually stored.
        await client.invalidateQueries();
      }
    } finally {
      setSyncing(false);
    }
  }, [client]);

  // Connectivity source: NetInfo on native, the browser's own events on web.
  useEffect(() => {
    if (Platform.OS === 'web') {
      const update = () => setOnline(globalThis.navigator?.onLine ?? true);
      update();
      globalThis.addEventListener?.('online', update);
      globalThis.addEventListener?.('offline', update);
      return () => {
        globalThis.removeEventListener?.('online', update);
        globalThis.removeEventListener?.('offline', update);
      };
    }

    const unsubscribe = NetInfo.addEventListener((state) => {
      // isInternetReachable is null while NetInfo is still probing — treat that
      // as connected rather than flashing an offline banner on every launch.
      const reachable = state.isInternetReachable ?? true;
      setOnline(Boolean(state.isConnected) && reachable);
    });
    return unsubscribe;
  }, []);

  // Drain on the offline -> online edge.
  useEffect(() => {
    if (online && !wasOnline.current) void sync();
    wasOnline.current = online;
  }, [online, sync]);

  // Also try when the app comes back to the foreground: a phone can regain
  // signal while asleep without NetInfo firing anything useful.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isOnline()) void sync();
    });
    return () => subscription.remove();
  }, [sync]);

  return (
    <OfflineContext.Provider
      value={{
        online,
        pending,
        failures,
        sync,
        syncing,
        clearFailures: async () => {
          await dismissFailures();
        },
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}
