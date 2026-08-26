import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Button,
  Caption,
  Card,
  Divider,
  EmptyState,
  InlineError,
  Row,
  Screen,
  SectionHeading,
  Title,
} from '@/components/ui';
import {
  useActiveTimesheet,
  useClockIn,
  useClockOut,
  useTimesheets,
} from '@/api/queries';
import { useCanManage, useCurrentUser } from '@/auth/store';
import { colors, spacing, typography } from '@/theme';
import { daysAgoIso, formatDate, formatDuration, formatTime } from '@/utils/format';

export default function HoursScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const canManage = useCanManage();

  const activeShift = useActiveTimesheet();
  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const [error, setError] = useState<string | null>(null);

  // Live-updating elapsed timer.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!activeShift.data) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [activeShift.data]);

  const fourteenDaysAgo = useMemo(() => daysAgoIso(14), []);

  const history = useTimesheets({ userId: user?.id, from: fourteenDaysAgo });
  const sheets = history.data ?? [];

  const totalMinutes = sheets.reduce((sum, sheet) => sum + (sheet.durationMinutes ?? 0), 0);

  const elapsed = activeShift.data
    ? Math.max(
        0,
        Math.floor((now - new Date(activeShift.data.clockInAt).getTime()) / 60000),
      )
    : 0;

  async function toggle() {
    setError(null);
    try {
      if (activeShift.data) await clockOut.mutateAsync(undefined);
      else await clockIn.mutateAsync();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error ? toggleError.message : 'Could not update your shift.',
      );
    }
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={activeShift.isRefetching || history.isRefetching}
          onRefresh={() => {
            void activeShift.refetch();
            void history.refetch();
          }}
        />
      }
    >
      <Card style={activeShift.data ? styles.clockOn : undefined}>
        <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md }}>
          <Caption>{activeShift.data ? 'Clocked in since' : 'You are clocked out'}</Caption>

          {activeShift.data ? (
            <>
              <Title style={styles.timer}>{formatDuration(elapsed)}</Title>
              <Caption>Started {formatTime(activeShift.data.clockInAt)}</Caption>
            </>
          ) : (
            <Title style={{ color: colors.muted }}>—</Title>
          )}

          <Button
            label={activeShift.data ? 'Clock out' : 'Clock in'}
            icon={activeShift.data ? 'stop' : 'play'}
            variant={activeShift.data ? 'secondary' : 'primary'}
            size="lg"
            loading={clockIn.isPending || clockOut.isPending}
            onPress={toggle}
            style={{ marginTop: spacing.sm, minWidth: 200 }}
          />
        </View>
      </Card>

      <InlineError message={error} />

      <View>
        <SectionHeading
          title="Last 14 days"
          action={
            canManage ? (
              <Button
                label="All staff"
                size="sm"
                variant="ghost"
                onPress={() => router.push('/(app)/timesheets')}
              />
            ) : null
          }
        />

        <Card padded={false}>
          <Row justify="space-between" style={styles.totalRow}>
            <Row gap={spacing.sm}>
              <Ionicons name="hourglass-outline" size={18} color={colors.navy} />
              <Text style={styles.totalLabel}>Recorded</Text>
            </Row>
            <Text style={styles.totalValue}>{formatDuration(totalMinutes)}</Text>
          </Row>

          {sheets.length === 0 ? (
            <View style={{ paddingBottom: spacing.lg }}>
              <EmptyState
                icon="time-outline"
                title="No shifts recorded yet"
                message="Clock in when you start work and out when you finish. Your hours appear here."
              />
            </View>
          ) : (
            sheets.map((sheet) => (
              <View key={sheet.id}>
                <Divider />
                <Row justify="space-between" style={styles.sheetRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetDate}>{formatDate(sheet.clockInAt)}</Text>
                    <Caption>
                      {formatTime(sheet.clockInAt)} –{' '}
                      {sheet.clockOutAt ? formatTime(sheet.clockOutAt) : 'still on shift'}
                      {sheet.note ? ` · ${sheet.note}` : ''}
                    </Caption>
                  </View>
                  <Text
                    style={[
                      styles.sheetDuration,
                      sheet.clockOutAt === null && { color: colors.green },
                    ]}
                  >
                    {sheet.clockOutAt === null ? 'Open' : formatDuration(sheet.durationMinutes)}
                  </Text>
                </Row>
              </View>
            ))
          )}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  clockOn: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  timer: { fontSize: 40, color: colors.greenDark, letterSpacing: -1 },
  totalRow: { padding: spacing.lg },
  totalLabel: { ...typography.smallStrong, color: colors.body },
  totalValue: { ...typography.heading, color: colors.ink },
  sheetRow: { padding: spacing.lg, gap: spacing.md },
  sheetDate: { ...typography.bodyStrong, color: colors.ink },
  sheetDuration: { ...typography.bodyStrong, color: colors.body },
});
