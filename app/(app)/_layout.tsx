import { View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/auth/store';
import { Loading } from '@/components/ui';
import { OfflineBanner } from '@/components/OfflineBanner';
import { colors, typography } from '@/theme';

export default function AppLayout() {
  const status = useAuth((state) => state.status);

  if (status === 'loading') return <Loading />;
  if (status === 'signed-out') return <Redirect href="/(auth)/login" />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.navy,
          headerTitleStyle: { ...typography.heading, color: colors.ink },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.canvas },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="job/new" options={{ title: 'New job', presentation: 'modal' }} />
        <Stack.Screen name="job/[id]" options={{ title: 'Job' }} />
        <Stack.Screen name="staff/index" options={{ title: 'Staff' }} />
        <Stack.Screen name="staff/new" options={{ title: 'Add staff', presentation: 'modal' }} />
        <Stack.Screen name="customers/index" options={{ title: 'Customers' }} />
        <Stack.Screen
          name="customers/new"
          options={{ title: 'Add customer', presentation: 'modal' }}
        />
        <Stack.Screen name="timesheets" options={{ title: 'Staff hours' }} />
        <Stack.Screen name="reports" options={{ title: 'Reports' }} />
        <Stack.Screen name="profile" options={{ title: 'Your account' }} />
        <Stack.Screen name="sync" options={{ title: 'Pending changes' }} />
      </Stack>

      {/* Pinned under the content so it's visible on every screen, including
          the tab screens, without each one having to render it. */}
      <OfflineBanner />
    </View>
  );
}
