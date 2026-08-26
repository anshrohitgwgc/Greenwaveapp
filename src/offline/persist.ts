/**
 * Persisted-cache plumbing.
 *
 * The key lives here rather than inline in the root layout because sign-out
 * has to be able to wipe it: work phones get shared between drivers, and the
 * next person to sign in must not see the last person's jobs, customers or
 * hours sitting in the cache before the first refetch lands.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const QUERY_CACHE_KEY = 'gw_query_cache_v1';

export async function clearPersistedCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUERY_CACHE_KEY);
  } catch {
    // Nothing useful to do — the in-memory clear still happened.
  }
}
