import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@/auth/store';
import { ApiError } from '@/api/client';
import { colors } from '@/theme';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
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
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <View style={{ flex: 1, backgroundColor: colors.canvas }}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(app)" />
            </Stack>
          </View>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
