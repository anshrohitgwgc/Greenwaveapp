import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import {
  Avatar,
  Badge,
  Caption,
  Card,
  Divider,
  ListItem,
  Row,
  Screen,
  SectionHeading,
} from '@/components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useCanManage, useCurrentUser, useIsAdmin } from '@/auth/store';
import { useOffline } from '@/offline/provider';
import { clearQueue } from '@/offline/queue';
import { clearPersistedCache } from '@/offline/persist';
import { config } from '@/api/config';
import { colors, spacing, typography } from '@/theme';
import { confirm } from '@/utils/dialogs';

const roleLabel: Record<string, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  driver: 'Driver',
};

export default function MoreScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const signOut = useAuth((state) => state.signOut);
  const canManage = useCanManage();
  const isAdmin = useIsAdmin();
  const { pending, failures, online } = useOffline();

  const unsent = pending.length + failures.length;

  async function handleSignOut() {
    // Signing out clears the token, and the queue can only be sent while
    // signed in — so warn before stranding a driver's unsent work.
    if (unsent > 0) {
      const proceed = await confirm({
        title: `${unsent} change${unsent === 1 ? '' : 's'} still on this phone`,
        message: online
          ? 'Give it a moment to finish sending before you sign out.'
          : "These can only be sent while you're signed in. Sign out now and they'll be lost.",
        confirmLabel: 'Sign out anyway',
        destructive: true,
      });
      if (!proceed) {
        router.push('/(app)/sync');
        return;
      }
    }

    const ok = await confirm({
      title: 'Sign out of GreenWave?',
      message: "You'll need your email and password to sign back in.",
      confirmLabel: 'Sign out',
      destructive: true,
    });
    if (!ok) return;

    // Work phones get shared. Leave nothing of this driver behind: the cached
    // jobs and hours, and any queued work that would otherwise be sent under
    // the next person's token.
    await clearQueue();
    queryClient.clear();
    await clearPersistedCache();
    await signOut();
  }

  return (
    <Screen>
      <Card>
        <Row gap={spacing.md}>
          <Avatar name={user?.fullName ?? '?'} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.fullName}</Text>
            <Caption>{user?.email}</Caption>
          </View>
          <Badge
            label={roleLabel[user?.role ?? ''] ?? 'Staff'}
            fg={colors.navy}
            bg={colors.waveSoft}
          />
        </Row>
      </Card>

      {canManage ? (
        <View>
          <SectionHeading title="Management" />
          <Card padded={false}>
            <ListItem
              icon="add-circle-outline"
              title="New job"
              subtitle="Schedule a pickup or dropoff"
              onPress={() => router.push('/(app)/job/new')}
            />
            <Divider />
            <ListItem
              icon="business-outline"
              title="Customers"
              subtitle="Sites you collect from and deliver to"
              onPress={() => router.push('/(app)/customers')}
            />
            <Divider />
            <ListItem
              icon="bar-chart-outline"
              title="Reports"
              subtitle="Material moved, by material and customer"
              onPress={() => router.push('/(app)/reports')}
            />
            <Divider />
            <ListItem
              icon="time-outline"
              title="Staff hours"
              subtitle="Shifts across the whole team"
              onPress={() => router.push('/(app)/timesheets')}
            />
            <Divider />
            <ListItem
              icon="people-outline"
              title="Staff"
              subtitle={isAdmin ? 'Add people and manage access' : 'View the team'}
              onPress={() => router.push('/(app)/staff')}
            />
          </Card>
        </View>
      ) : null}

      <View>
        <SectionHeading title="Account" />
        <Card padded={false}>
          <ListItem
            icon="person-circle-outline"
            title="Your account"
            subtitle="Change your password"
            onPress={() => router.push('/(app)/profile')}
          />
          <Divider />
          <ListItem
            icon={online ? 'cloud-done-outline' : 'cloud-offline-outline'}
            title="Pending changes"
            subtitle={
              unsent === 0
                ? 'Everything has been sent'
                : `${unsent} waiting${online ? '' : ' — offline'}`
            }
            onPress={() => router.push('/(app)/sync')}
            right={
              unsent > 0 ? (
                <Badge
                  label={String(unsent)}
                  fg={failures.length > 0 ? colors.red : colors.amber}
                  bg={failures.length > 0 ? colors.redSoft : colors.amberSoft}
                />
              ) : undefined
            }
          />
          <Divider />
          <ListItem
            icon="log-out-outline"
            title="Sign out"
            onPress={handleSignOut}
            destructive
            right={<View />}
          />
        </Card>
      </View>

      <View>
        <SectionHeading title="About" />
        <Card>
          <View style={{ gap: spacing.xs }}>
            <Row justify="space-between">
              <Caption>Version</Caption>
              <Caption>{Constants.expoConfig?.version ?? '1.0.0'}</Caption>
            </Row>
            <Row justify="space-between">
              <Caption>API</Caption>
              <Caption>{config.useMock ? 'Demo data (mock mode)' : config.apiBaseUrl}</Caption>
            </Row>
            <Row justify="space-between">
              <Caption>Connection</Caption>
              <Caption>{online ? 'Online' : 'Offline'}</Caption>
            </Row>
          </View>
          {config.useMock ? (
            <Caption style={{ marginTop: spacing.sm }}>
              Demo mode uses in-memory data. Set EXPO_PUBLIC_USE_MOCK=0 in .env and restart to
              use your real API.
            </Caption>
          ) : null}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { ...typography.heading, color: colors.ink },
});
