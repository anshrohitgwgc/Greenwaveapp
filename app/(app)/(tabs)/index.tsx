import { useCallback, useMemo } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Row,
  Screen,
  SectionHeading,
  StatTile,
  Title,
} from '@/components/ui';
import { JobCard } from '@/components/JobCard';
import { useActiveTimesheet, useClockIn, useJobs, useTodaySummary } from '@/api/queries';
import { useCanManage, useCurrentUser } from '@/auth/store';
import { colors, radius, spacing, typography } from '@/theme';
import { elapsedSince, formatWeight, localDayRange } from '@/utils/format';

export default function TodayScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const canManage = useCanManage();

  const jobQuery = useMemo(() => {
    const { fromIso, toIso } = localDayRange();
    return {
      from: fromIso,
      to: toIso,
      ...(canManage ? {} : { assignedToId: user?.id }),
      pageSize: 50,
    };
  }, [canManage, user?.id]);

  const summary = useTodaySummary();
  const jobs = useJobs(jobQuery);
  const activeShift = useActiveTimesheet();
  const clockIn = useClockIn();

  const refreshing =
    summary.isRefetching || jobs.isRefetching || activeShift.isRefetching;

  const onRefresh = useCallback(() => {
    void summary.refetch();
    void jobs.refetch();
    void activeShift.refetch();
  }, [summary, jobs, activeShift]);

  const greeting = getGreeting();
  const firstName = user?.fullName.split(' ')[0] ?? 'there';

  if (jobs.isLoading && summary.isLoading) return <Loading />;
  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />;

  const items = jobs.data?.items ?? [];
  const open = items.filter((job) => job.status !== 'completed' && job.status !== 'cancelled');
  const done = items.filter((job) => job.status === 'completed');

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <View>
        <Caption>{greeting}</Caption>
        <Title>{firstName}</Title>
      </View>

      {/* Shift prompt */}
      {activeShift.data ? (
        <Card style={styles.shiftOn}>
          <Row justify="space-between">
            <Row gap={spacing.sm}>
              <View style={styles.pulse} />
              <View>
                <Text style={styles.shiftOnTitle}>On shift</Text>
                <Caption>{elapsedSince(activeShift.data.clockInAt)} so far</Caption>
              </View>
            </Row>
            <Button
              label="Hours"
              variant="secondary"
              size="sm"
              onPress={() => router.push('/(app)/(tabs)/hours')}
            />
          </Row>
        </Card>
      ) : (
        <Card>
          <Row justify="space-between">
            <View style={{ flex: 1 }}>
              <Text style={styles.shiftOffTitle}>Not clocked in</Text>
              <Caption>Start your shift to record hours against today.</Caption>
            </View>
            <Button
              label="Clock in"
              icon="play"
              size="sm"
              loading={clockIn.isPending}
              onPress={() => clockIn.mutate()}
            />
          </Row>
        </Card>
      )}

      {/* Numbers */}
      <View>
        <SectionHeading title="Today at a glance" />
        <View style={styles.tiles}>
          <StatTile
            label="Pickups"
            value={String(summary.data?.pickups ?? 0)}
            icon="arrow-up-circle-outline"
            tint={colors.green}
          />
          <StatTile
            label="Dropoffs"
            value={String(summary.data?.dropoffs ?? 0)}
            icon="arrow-down-circle-outline"
            tint={colors.wave}
          />
          <StatTile
            label="Completed"
            value={String(summary.data?.completed ?? 0)}
            icon="checkmark-circle-outline"
            tint={colors.greenDark}
          />
          <StatTile
            label="Material"
            value={formatWeight(summary.data?.weightKg ?? 0)}
            icon="scale-outline"
            tint={colors.navy}
          />
        </View>
      </View>

      {/* Open work */}
      <View style={{ gap: spacing.md }}>
        <SectionHeading
          title={canManage ? "Today's schedule" : 'Your jobs today'}
          action={
            canManage ? (
              <Button
                label="New job"
                icon="add"
                size="sm"
                variant="ghost"
                onPress={() => router.push('/(app)/job/new')}
              />
            ) : null
          }
        />

        {open.length === 0 && done.length === 0 ? (
          <Card>
            <EmptyState
              icon="calendar-outline"
              title="Nothing scheduled today"
              message={
                canManage
                  ? 'Create a pickup or dropoff and assign it to a driver.'
                  : 'No jobs are assigned to you today. Check the Jobs tab for what is coming up.'
              }
              action={
                canManage ? (
                  <Button
                    label="Create a job"
                    icon="add"
                    onPress={() => router.push('/(app)/job/new')}
                  />
                ) : null
              }
            />
          </Card>
        ) : (
          <View style={{ gap: spacing.md }}>
            {open.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onPress={() => router.push({ pathname: '/(app)/job/[id]', params: { id: job.id } })}
              />
            ))}
          </View>
        )}
      </View>

      {done.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          <SectionHeading title={`Completed today (${done.length})`} />
          {done.map((job) => (
            <JobCard key={job.id} job={job} onPress={() => router.push({ pathname: '/(app)/job/[id]', params: { id: job.id } })} />
          ))}
        </View>
      ) : null}

      {canManage && summary.data ? (
        <Card>
          <Row gap={spacing.sm}>
            <Ionicons name="people-outline" size={18} color={colors.navy} />
            <Text style={styles.body}>
              {summary.data.staffOnShift === 0
                ? 'Nobody is clocked in right now.'
                : `${summary.data.staffOnShift} ${
                    summary.data.staffOnShift === 1 ? 'person is' : 'people are'
                  } on shift.`}
            </Text>
          </Row>
        </Card>
      ) : null}
    </Screen>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  shiftOn: { borderColor: colors.green, backgroundColor: colors.greenSoft },
  shiftOnTitle: { ...typography.bodyStrong, color: colors.greenDark },
  shiftOffTitle: { ...typography.bodyStrong, color: colors.ink },
  pulse: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
  },
  body: { ...typography.body, color: colors.body, flex: 1 },
});
