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
import { useAuth, useCanManage, useCurrentUser, useIsAdmin } from '@/auth/store';
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
  const user = useCurrentUser();
  const signOut = useAuth((state) => state.signOut);
  const canManage = useCanManage();
  const isAdmin = useIsAdmin();

  async function handleSignOut() {
    const ok = await confirm({
      title: 'Sign out of GreenWave?',
      message: "You'll need your email and password to sign back in.",
      confirmLabel: 'Sign out',
      destructive: true,
    });
    if (ok) await signOut();
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
              icon="people-outline"
              title="Staff"
              subtitle={isAdmin ? 'Add people and manage access' : 'View the team'}
              onPress={() => router.push('/(app)/staff')}
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
              icon="add-circle-outline"
              title="New job"
              subtitle="Schedule a pickup or dropoff"
              onPress={() => router.push('/(app)/job/new')}
            />
          </Card>
        </View>
      ) : null}

      <View>
        <SectionHeading title="Account" />
        <Card padded={false}>
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
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { ...typography.heading, color: colors.ink },
});
