import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Button,
  Caption,
  EmptyState,
  ErrorState,
  Loading,
  Row,
  Chip,
  Segmented,
  TextField,
} from '@/components/ui';
import { JobCard } from '@/components/JobCard';
import { useJobs } from '@/api/queries';
import { useCanManage, useCurrentUser } from '@/auth/store';
import { CONTENT_MAX_WIDTH, colors, spacing, statusMeta } from '@/theme';
import { JOB_STATUSES, type JobStatus, type JobType } from '@/api/types';

type TypeFilter = 'all' | JobType;
type ScopeFilter = 'mine' | 'all';

export default function JobsScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const canManage = useCanManage();

  const [search, setSearch] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [scope, setScope] = useState<ScopeFilter>(canManage ? 'all' : 'mine');

  const query = useMemo(
    () => ({
      ...(type !== 'all' ? { type } : {}),
      ...(status ? { status } : {}),
      ...(scope === 'mine' && user?.id ? { assignedToId: user.id } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
      pageSize: 100,
    }),
    [type, status, scope, search, user?.id],
  );

  const jobs = useJobs(query);
  const items = jobs.data?.items ?? [];

  const header = (
    <View style={styles.header}>
      <TextField
        value={search}
        onChangeText={setSearch}
        placeholder="Search reference, customer or address"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        inputMode="search"
      />

      <Segmented<TypeFilter>
        value={type}
        onChange={setType}
        options={[
          { value: 'all', label: 'All' },
          { value: 'pickup', label: 'Pickups' },
          { value: 'dropoff', label: 'Dropoffs' },
        ]}
      />

      {canManage ? (
        <Segmented<ScopeFilter>
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'mine', label: 'Assigned to me' },
          ]}
        />
      ) : null}

      <Row gap={spacing.sm} wrap>
        <Chip label="Any status" active={status === null} onPress={() => setStatus(null)} />
        {JOB_STATUSES.map((value) => (
          <Chip
            key={value}
            label={statusMeta[value].label}
            active={status === value}
            onPress={() => setStatus(status === value ? null : value)}
          />
        ))}
      </Row>

      {jobs.isFetching && !jobs.isLoading ? (
        <Caption>Updating…</Caption>
      ) : (
        <Caption>
          {items.length} {items.length === 1 ? 'job' : 'jobs'}
          {jobs.data && jobs.data.total > items.length ? ` of ${jobs.data.total}` : ''}
        </Caption>
      )}
    </View>
  );

  if (jobs.isLoading) return <Loading label="Loading jobs…" />;
  if (jobs.isError) {
    return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />;
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={items}
        keyExtractor={(job) => job.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={jobs.isRefetching} onRefresh={() => void jobs.refetch()} />
        }
        renderItem={({ item }) => (
          <JobCard
            job={item}
            onPress={() => router.push({ pathname: '/(app)/job/[id]', params: { id: item.id } })}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title="No jobs match those filters"
            message="Try clearing the status filter or searching for something else."
            action={
              <Button
                label="Clear filters"
                variant="secondary"
                onPress={() => {
                  setSearch('');
                  setType('all');
                  setStatus(null);
                  setScope(canManage ? 'all' : 'mine');
                }}
              />
            }
          />
        }
      />

      {canManage ? (
        <View style={styles.fab}>
          <Button label="New job" icon="add" size="lg" onPress={() => router.push('/(app)/job/new')} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  list: {
    padding: spacing.lg,
    paddingBottom: 110,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    flexGrow: 1,
  },
  header: { gap: spacing.md, marginBottom: spacing.lg },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    left: spacing.lg,
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
});
