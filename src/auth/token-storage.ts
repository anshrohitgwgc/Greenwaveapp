/**
 * Token persistence.
 *
 * Native  -> expo-secure-store (Keychain on iOS, EncryptedSharedPreferences
 *            on Android). Refresh tokens never touch AsyncStorage.
 * Web     -> localStorage. Browsers have no keychain; if you later want
 *            httpOnly-cookie auth for the web build, swap this module and
 *            set `credentials: 'include'` in `client.ts`.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'gw_access_token';
const REFRESH_KEY = 'gw_refresh_token';

const isWeb = Platform.OS === 'web';

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* private mode / storage disabled — session stays in memory only */
    }
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function removeItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* noop */
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export const tokenStorage = {
  async save(tokens: StoredTokens): Promise<void> {
    await Promise.all([
      setItem(ACCESS_KEY, tokens.accessToken),
      setItem(REFRESH_KEY, tokens.refreshToken),
    ]);
  },

  async load(): Promise<StoredTokens | null> {
    const [accessToken, refreshToken] = await Promise.all([
      getItem(ACCESS_KEY),
      getItem(REFRESH_KEY),
    ]);
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  },

  async clear(): Promise<void> {
    await Promise.all([removeItem(ACCESS_KEY), removeItem(REFRESH_KEY)]);
  },
};
