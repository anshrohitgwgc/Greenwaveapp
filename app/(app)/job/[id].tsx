import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Badge,
  Button,
  Caption,
  Card,
  Divider,
  ErrorState,
  InlineError,
  Loading,
  Row,
  Screen,
  SectionHeading,
  Select,
  Title,
} from '@/components/ui';
import { WeightEntry } from '@/components/WeightEntry';
import { PhotoGrid } from '@/components/PhotoGrid';
import { useJob, useSetJobStatus, useStaff, useUpdateJob } from '@/api/queries';
import { useCanManage, useCurrentUser } from '@/auth/store';
import { colors, spacing, statusMeta, typeMeta, typography } from '@/theme';
import { formatDayTime, formatWeight } from '@/utils/format';
import { confirm } from '@/utils/dialogs';
import type { JobStatus } from '@/api/types';

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useCurrentUser();
  const canManage = useCanManage();

  const job = useJob(id);
  const setStatus = useSetJobStatus(id ?? '');
  const updateJob = useUpdateJob(id ?? '');
  const staff = useStaff();

  const [error, setError] = useState<string | null>(null);

  const driverOptions = useMemo(
    () =>
      (staff.data ?? [])
        .filter((member) => member.active)
        .map((member) => ({
          value: member.id,
          label: member.fullName,
          sublabel: member.role,
        })),
    [staff.data],
  );

  if (job.isLoading) return <Loading label="Loading job…" />;
  if (job.isError || !job.data) {
    return <ErrorState error={job.error} onRetry={() => void job.refetch()} />;
  }

  const data = job.data;
  const type = typeMeta[data.type];
  const status = statusMeta[data.status];

  const isMine = data.assignedToId === user?.id;
  const isClosed = data.status === 'completed' || data.status === 'cancelled';
  // Drivers record against their own open jobs; managers can always edit.
  const canEdit = canManage || (isMine && !isClosed);

  async function changeStatus(next: JobStatus, confirmMessage?: string) {
    setError(null);

    if (confirmMessage) {
      const ok = await confirm({
        title: confirmMessage,
        confirmLabel: 'Yes, continue',
      });
      if (!ok) return;
    }

    try {
      await setStatus.mutateAsync(next);
    } catch (statusError) {
      setError(
        statusError instanceof Error ? statusError.message : 'Could not update the job.',
      );
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: data.reference }} />
      <Screen
        refreshControl={
          <RefreshControl refreshing={job.isRefetching} onRefresh={() => void job.refetch()} />
        }
      >
        {/* Summary */}
        <Card>
          <Row justify="space-between" align="flex-start">
            <Row gap={spacing.sm}>
              <View style={[styles.typeDot, { backgroundColor: `${type.tint}1A` }]}>
                <Ionicons name={type.icon as never} size={18} color={type.tint} />
              </View>
              <View>
                <Title>{type.label}</Title>
                <Caption>{data.reference}</Caption>
              </View>
            </Row>
            <Badge label={status.label} fg={status.fg} bg={status.bg} />
          </Row>

          <Divider style={{ marginVertical: spacing.lg }} />

          <View style={{ gap: spacing.md }}>
            <DetailRow icon="business-outline" label="Customer" value={data.customerName ?? '—'} />
            <DetailRow icon="location-outline" label="Address" value={data.address ?? '—'} />
            <DetailRow
              icon="calendar-outline"
              label="Scheduled"
              value={formatDayTime(data.scheduledFor)}
            />
            <DetailRow
              icon="person-outline"
              label="Assigned to"
              value={data.assignedToName ?? 'Nobody yet'}
            />
            {data.totalWeightKg > 0 ? (
              <DetailRow
                icon="scale-outline"
                label="Total weight"
                value={formatWeight(data.totalWeightKg)}
              />
            ) : null}
            {data.notes ? (
              <DetailRow icon="document-text-outline" label="Notes" value={data.notes} />
            ) : null}
          </View>
        </Card>

        <InlineError message={error} />

        {/* Status actions */}
        {!isClosed && (canManage || isMine) ? (
          <Card>
            <SectionHeading title="Update status" />
            <Row gap={spacing.sm} wrap>
              {data.status !== 'in_progress' ? (
                <Button
                  label="Start job"
                  icon="play"
                  onPress={() => changeStatus('in_progress')}
                  loading={setStatus.isPending}
                />
              ) : null}
              <Button
                label="Mark completed"
                icon="checkmark"
                variant={data.status === 'in_progress' ? 'primary' : 'secondary'}
                loading={setStatus.isPending}
                onPress={() =>
                  changeStatus(
                    'completed',
                    data.lines.length === 0
                      ? 'No materials recorded — complete anyway?'
                      : undefined,
                  )
                }
              />
              {canManage ? (
                <Button
                  label="Cancel job"
                  variant="danger"
                  loading={setStatus.isPending}
                  onPress={() => changeStatus('cancelled', 'Cancel this job?')}
                />
              ) : null}
            </Row>
          </Card>
        ) : null}

        {isClosed ? (
          <Card style={styles.closedBanner}>
            <Row gap={spacing.sm}>
              <Ionicons
                name={data.status === 'completed' ? 'checkmark-circle' : 'close-circle'}
                size={18}
                color={status.fg}
              />
              <Text style={[styles.closedText, { color: status.fg }]}>
                {data.status === 'completed'
                  ? `Completed${data.completedAt ? ` ${formatDayTime(data.completedAt)}` : ''}.`
                  : 'This job was cancelled.'}
                {canManage ? '' : ' Ask a manager if something needs changing.'}
              </Text>
            </Row>
            {canManage ? (
              <Button
                label="Reopen"
                variant="secondary"
                size="sm"
                style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
                onPress={() => changeStatus('in_progress', 'Reopen this job?')}
              />
            ) : null}
          </Card>
        ) : null}

        {/* Materials & weights */}
        <View>
          <SectionHeading title="Materials & weights" />
          <Card>
            <WeightEntry
              jobId={data.id}
              lines={data.lines}
              totalKg={data.totalWeightKg}
              editable={canEdit}
            />
          </Card>
        </View>

        {/* Photos */}
        <View>
          <SectionHeading title="Photos" />
          <Card>
            <PhotoGrid jobId={data.id} photos={data.photos} editable={canEdit} />
          </Card>
        </View>

        {/* Manager-only reassignment */}
        {canManage ? (
          <View>
            <SectionHeading title="Assignment" />
            <Card>
              <Select
                label="Assigned driver"
                placeholder="Nobody assigned"
                value={data.assignedToId}
                options={driverOptions}
                onChange={(value) => {
                  setError(null);
                  updateJob.mutate(
                    { assignedToId: value },
                    {
                      onError: (assignError) =>
                        setError(
                          assignError instanceof Error
                            ? assignError.message
                            : 'Could not reassign the job.',
                        ),
                    },
                  );
                }}
              />
              <Button
                label="Edit job details"
                variant="secondary"
                icon="create-outline"
                style={{ marginTop: spacing.md }}
                onPress={() =>
                  router.push({ pathname: '/(app)/job/new', params: { editId: data.id } })
                }
              />
            </Card>
          </View>
        ) : null}
      </Screen>
    </>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  return (
    <Row gap={spacing.md} align="flex-start">
      <Ionicons name={icon} size={16} color={colors.muted} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  typeDot: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailLabel: { ...typography.small, color: colors.muted },
  detailValue: { ...typography.body, color: colors.ink },
  closedBanner: { backgroundColor: colors.canvas },
  closedText: { ...typography.smallStrong, flex: 1 },
});
