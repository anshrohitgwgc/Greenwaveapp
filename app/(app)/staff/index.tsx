import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Avatar,
  Badge,
  Button,
  Caption,
  Card,
  Divider,
  ErrorState,
  Loading,
  Row,
  Screen,
  SectionHeading,
} from '@/components/ui';
import { useStaff, useUpdateStaff } from '@/api/queries';
import { useIsAdmin } from '@/auth/store';
import { colors, spacing, typography } from '@/theme';
import { confirm } from '@/utils/dialogs';
import type { Role, User } from '@/api/types';

const roleBadge: Record<Role, { label: string; fg: string; bg: string }> = {
  admin: { label: 'ADMIN', fg: colors.navy, bg: colors.waveSoft },
  manager: { label: 'MANAGER', fg: colors.blue, bg: colors.blueSoft },
  driver: { label: 'DRIVER', fg: colors.greenDark, bg: colors.greenSoft },
};

export default function StaffScreen() {
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const staff = useStaff();
  const updateStaff = useUpdateStaff();

  if (staff.isLoading) return <Loading label="Loading staff…" />;
  if (staff.isError) return <ErrorState error={staff.error} onRetry={() => void staff.refetch()} />;

  const members = staff.data ?? [];
  const active = members.filter((member) => member.active);

  async function toggleActive(member: User) {
    const ok = await confirm({
      title: member.active ? `Deactivate ${member.fullName}?` : `Reactivate ${member.fullName}?`,
      message: member.active
        ? 'They will not be able to sign in until you reactivate them. Their past jobs and hours are kept.'
        : 'They will be able to sign in again with their existing password.',
      confirmLabel: member.active ? 'Deactivate' : 'Reactivate',
      destructive: member.active,
    });
    if (!ok) return;
    updateStaff.mutate({ userId: member.id, patch: { active: !member.active } });
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={staff.isRefetching} onRefresh={() => void staff.refetch()} />
      }
    >
      <Card>
        <Row justify="space-between">
          <View>
            <Text style={styles.count}>{active.length} active</Text>
            <Caption>
              {members.length} account{members.length === 1 ? '' : 's'} total
            </Caption>
          </View>
          {isAdmin ? (
            <Button
              label="Add staff"
              icon="person-add-outline"
              size="sm"
              onPress={() => router.push('/(app)/staff/new')}
            />
          ) : null}
        </Row>
      </Card>

      <View>
        <SectionHeading title="Team" />
        <Card padded={false}>
          {members.map((member, index) => (
            <View key={member.id}>
              {index > 0 ? <Divider /> : null}
              <Row gap={spacing.md} style={styles.row}>
                <Avatar name={member.fullName} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, !member.active && styles.inactive]} numberOfLines={1}>
                    {member.fullName}
                  </Text>
                  <Caption>{member.email}</Caption>
                </View>
                <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                  <Badge {...roleBadge[member.role]} />
                  {isAdmin ? (
                    <Text
                      accessibilityRole="button"
                      onPress={() => toggleActive(member)}
                      style={[
                        styles.toggle,
                        { color: member.active ? colors.muted : colors.green },
                      ]}
                    >
                      {member.active ? 'Deactivate' : 'Reactivate'}
                    </Text>
                  ) : !member.active ? (
                    <Caption>Inactive</Caption>
                  ) : null}
                </View>
              </Row>
            </View>
          ))}
        </Card>
      </View>

      <Caption style={{ textAlign: 'center' }}>
        Staff sign in with the email on their account. Deactivating blocks sign-in immediately
        without deleting their history.
      </Caption>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { padding: spacing.lg },
  count: { ...typography.heading, color: colors.ink },
  name: { ...typography.bodyStrong, color: colors.ink },
  inactive: { color: colors.muted, textDecorationLine: 'line-through' },
  toggle: { ...typography.small, fontWeight: '600' },
});
