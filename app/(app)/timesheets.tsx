import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import {
  Avatar,
  Badge,
  Caption,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Loading,
  Row,
  Screen,
  SectionHeading,
  Segmented,
} from '@/components/ui';
import { useTimesheets } from '@/api/queries';
import { useCanManage } from '@/auth/store';
import { colors, spacing, typography } from '@/theme';
import { daysAgoIso, formatDate, formatDuration, formatTime } from '@/utils/format';
import type { Timesheet } from '@/api/types';

type Range = '7' | '14' | '30';

export default function TimesheetsScreen() {
  const canManage = useCanManage();
  const [range, setRange] = useState<Range>('7');

  const from = useMemo(() => daysAgoIso(Number.parseInt(range, 10)), [range]);

  const timesheets = useTimesheets({ from });

  if (!canManage) return <Redirect href="/(app)/(tabs)" />;
  if (timesheets.isLoading) return <Loading label="Loading hours…" />;
  if (timesheets.isError) {
    return <ErrorState error={timesheets.error} onRetry={() => void timesheets.refetch()} />;
  }

  const sheets = timesheets.data ?? [];
  const byPerson = groupByPerson(sheets);
  const grandTotal = sheets.reduce((sum, sheet) => sum + (sheet.durationMinutes ?? 0), 0);

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={timesheets.isRefetching}
          onRefresh={() => void timesheets.refetch()}
        />
      }
    >
      <Segmented<Range>
        value={range}
        onChange={setRange}
        options={[
          { value: '7', label: 'Last 7 days' },
          { value: '14', label: 'Last 14 days' },
          { value: '30', label: 'Last 30 days' },
        ]}
      />

      <Card>
        <Row justify="space-between">
          <View>
            <Text style={styles.total}>{formatDuration(grandTotal)}</Text>
            <Caption>
              across {byPerson.length} {byPerson.length === 1 ? 'person' : 'people'}
            </Caption>
          </View>
          <Caption>{sheets.length} shifts</Caption>
        </Row>
      </Card>

      {byPerson.length === 0 ? (
        <Card>
          <EmptyState
            icon="time-outline"
            title="No hours in this period"
            message="Shifts appear here as staff clock in and out."
          />
        </Card>
      ) : (
        byPerson.map((person) => (
          <View key={person.userId}>
            <SectionHeading title={person.userName} />
            <Card padded={false}>
              <Row justify="space-between" style={styles.personHeader}>
                <Row gap={spacing.sm}>
                  <Avatar name={person.userName} size={32} />
                  <View>
                    <Text style={styles.personName}>{person.userName}</Text>
                    <Caption>
                      {person.sheets.length} {person.sheets.length === 1 ? 'shift' : 'shifts'}
                    </Caption>
                  </View>
                </Row>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={styles.personTotal}>{formatDuration(person.totalMinutes)}</Text>
                  {person.open ? (
                    <Badge label="ON SHIFT" fg={colors.greenDark} bg={colors.greenSoft} />
                  ) : null}
                </View>
              </Row>

              {person.sheets.map((sheet) => (
                <View key={sheet.id}>
                  <Divider />
                  <Row justify="space-between" style={styles.sheetRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sheetDate}>{formatDate(sheet.clockInAt)}</Text>
                      <Caption>
                        {formatTime(sheet.clockInAt)} –{' '}
                        {sheet.clockOutAt ? formatTime(sheet.clockOutAt) : 'open'}
                        {sheet.note ? ` · ${sheet.note}` : ''}
                      </Caption>
                    </View>
                    <Text style={styles.sheetDuration}>
                      {sheet.clockOutAt ? formatDuration(sheet.durationMinutes) : '—'}
                    </Text>
                  </Row>
                </View>
              ))}
            </Card>
          </View>
        ))
      )}
    </Screen>
  );
}

interface PersonGroup {
  userId: string;
  userName: string;
  sheets: Timesheet[];
  totalMinutes: number;
  open: boolean;
}

function groupByPerson(sheets: Timesheet[]): PersonGroup[] {
  const map = new Map<string, PersonGroup>();

  for (const sheet of sheets) {
    const existing = map.get(sheet.userId);
    if (existing) {
      existing.sheets.push(sheet);
      existing.totalMinutes += sheet.durationMinutes ?? 0;
      existing.open = existing.open || sheet.clockOutAt === null;
    } else {
      map.set(sheet.userId, {
        userId: sheet.userId,
        userName: sheet.userName,
        sheets: [sheet],
        totalMinutes: sheet.durationMinutes ?? 0,
        open: sheet.clockOutAt === null,
      });
    }
  }

  return [...map.values()].sort((a, b) => b.totalMinutes - a.totalMinutes);
}

const styles = StyleSheet.create({
  total: { ...typography.display, color: colors.ink },
  personHeader: { padding: spacing.lg },
  personName: { ...typography.bodyStrong, color: colors.ink },
  personTotal: { ...typography.heading, color: colors.greenDark },
  sheetRow: { padding: spacing.lg, gap: spacing.md },
  sheetDate: { ...typography.body, color: colors.ink },
  sheetDuration: { ...typography.bodyStrong, color: colors.body },
});
