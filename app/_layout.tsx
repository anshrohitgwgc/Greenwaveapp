import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/auth/store';
import { ApiError } from '@/api/client';
import { OfflineProvider } from '@/offline/provider';
import { QUERY_CACHE_KEY } from '@/offline/persist';
import { colors } from '@/theme';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Keep cached data for a week so a phone that's been offline all day
      // still opens with yesterday's jobs rather than an empty screen.
      gcTime: 7 * 24 * 60 * 60 * 1000,
      retry: (failureCount, error) => {
        // Never retry auth/permission failures — only transient ones.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: QUERY_CACHE_KEY,
  throttleTime: 2_000,
});

export default function RootLayout() {
  const restore = useAuth((state) => state.restore);
  const status = useAuth((state) => state.status);
  const [splashHidden, setSplashHidden] = useState(false);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    if (status !== 'loading' && !splashHidden) {
      setSplashHidden(true);
      void SplashScreen.hideAsync();
    }
  }, [status, splashHidden]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            // Bump this string whenever a cached shape changes, so an old
            // cache is discarded instead of rehydrating into new code.
            buster: 'v1',
          }}
        >
          <OfflineProvider>
            <StatusBar style="dark" />
            <View style={{ flex: 1, backgroundColor: colors.canvas }}>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(app)" />
              </Stack>
            </View>
          </OfflineProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
