import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Button,
  Caption,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  InlineError,
  Loading,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  StatTile,
} from '@/components/ui';
import { useJobs, useMaterials } from '@/api/queries';
import { useCanManage } from '@/auth/store';
import { colors, radius, spacing, typography } from '@/theme';
import { daysAgoIso, formatDate, formatWeight } from '@/utils/format';
import { exportCsv, toCsv } from '@/utils/export';
import type { Job } from '@/api/types';

type Range = '7' | '30' | '90';

const RANGE_LABEL: Record<Range, string> = {
  '7': 'Last 7 days',
  '30': 'Last 30 days',
  '90': 'Last 90 days',
};

interface Breakdown {
  key: string;
  label: string;
  weightKg: number;
  jobs: number;
  value: number | null;
}

export default function ReportsScreen() {
  const canManage = useCanManage();
  const [range, setRange] = useState<Range>('30');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const from = useMemo(() => daysAgoIso(Number.parseInt(range, 10)), [range]);
  const jobs = useJobs({ from, pageSize: 500 });
  const materials = useMaterials();

  const completed = useMemo(
    () => (jobs.data?.items ?? []).filter((job) => job.status === 'completed'),
    [jobs.data],
  );

  /** materialId -> $/kg, for the materials that have a rate set. */
  const rates = useMemo(() => {
    const map = new Map<string, number>();
    for (const material of materials.data ?? []) {
      if (typeof material.ratePerKg === 'number') map.set(material.id, material.ratePerKg);
    }
    return map;
  }, [materials.data]);

  const totals = useMemo(() => summarise(completed, rates), [completed, rates]);

  if (!canManage) return <Redirect href="/(app)/(tabs)" />;
  if (jobs.isLoading) return <Loading label="Building report…" />;
  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />;

  async function download() {
    setExportError(null);
    setExporting(true);
    try {
      const csv = toCsv(
        [
          'Reference',
          'Type',
          'Customer',
          'Address',
          'Completed',
          'Driver',
          'Material',
          'Weight (kg)',
          'Notes',
        ],
        completed.flatMap((job) =>
          job.lines.length > 0
            ? job.lines.map((line) => [
                job.reference,
                job.type,
                job.customerName,
                job.address,
                job.completedAt ?? job.scheduledFor,
                job.assignedToName,
                line.materialName,
                line.weightKg,
                line.notes,
              ])
            : [
                [
                  job.reference,
                  job.type,
                  job.customerName,
                  job.address,
                  job.completedAt ?? job.scheduledFor,
                  job.assignedToName,
                  '',
                  0,
                  'No materials recorded',
                ],
              ],
        ),
      );
      const result = await exportCsv(`greenwave-${range}d-report.csv`, csv);
      if (!result.ok) setExportError(result.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Reports' }} />
      <Screen>
        <Segmented<Range>
          value={range}
          onChange={setRange}
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
          ]}
        />

        <Caption>
          {RANGE_LABEL[range]} · completed jobs only. Scheduled and cancelled work is excluded
          so the weights reflect material actually moved.
        </Caption>

        <View style={styles.tiles}>
          <StatTile
            label="Material moved"
            value={formatWeight(totals.weightKg)}
            icon="scale-outline"
            tint={colors.green}
          />
          <StatTile
            label="Jobs completed"
            value={String(completed.length)}
            icon="checkmark-circle-outline"
            tint={colors.greenDark}
          />
          <StatTile
            label="Pickups"
            value={String(completed.filter((job) => job.type === 'pickup').length)}
            icon="arrow-up-circle-outline"
            tint={colors.wave}
          />
          <StatTile
            label="Est. value"
            value={totals.value === null ? '—' : `$${totals.value.toFixed(2)}`}
            icon="pricetag-outline"
            tint={colors.navy}
          />
        </View>

        {totals.value === null ? (
          <Caption>
            Estimated value needs a rate per kg on your materials. Add rates and it appears
            here.
          </Caption>
        ) : null}

        {completed.length === 0 ? (
          <Card>
            <EmptyState
              icon="bar-chart-outline"
              title="No completed jobs in this period"
              message="Once drivers complete jobs with weights recorded, the breakdown appears here."
            />
          </Card>
        ) : (
          <>
            <BreakdownCard
              title="By material"
              rows={totals.byMaterial}
              max={totals.byMaterial[0]?.weightKg ?? 0}
            />
            <BreakdownCard
              title="By customer"
              rows={totals.byCustomer}
              max={totals.byCustomer[0]?.weightKg ?? 0}
            />

            <View>
              <SectionHeading title="Export" />
              <Card>
                <Row gap={spacing.md}>
                  <Ionicons name="document-text-outline" size={20} color={colors.navy} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exportTitle}>One row per material line</Text>
                    <Caption>
                      Opens in Excel, Numbers or Sheets. Use it for invoicing and for your
                      recycler&apos;s monthly reconciliation.
                    </Caption>
                  </View>
                </Row>
                <InlineError message={exportError} />
                <Button
                  label="Export CSV"
                  icon="download-outline"
                  variant="secondary"
                  loading={exporting}
                  onPress={download}
                  style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
                />
              </Card>
            </View>

            <View>
              <SectionHeading title={`Completed jobs (${completed.length})`} />
              <Card padded={false}>
                {completed.slice(0, 25).map((job, index) => (
                  <View key={job.id}>
                    {index > 0 ? <Divider /> : null}
                    <Row justify="space-between" style={styles.jobRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.jobRef}>
                          {job.reference} · {job.customerName ?? 'No customer'}
                        </Text>
                        <Caption>
                          {formatDate(job.completedAt ?? job.scheduledFor)} ·{' '}
                          {job.assignedToName ?? 'Unassigned'}
                        </Caption>
                      </View>
                      <Text style={styles.jobWeight}>{formatWeight(job.totalWeightKg)}</Text>
                    </Row>
                  </View>
                ))}
                {completed.length > 25 ? (
                  <>
                    <Divider />
                    <Caption style={{ padding: spacing.lg, textAlign: 'center' }}>
                      Showing the 25 most recent. The CSV export contains all {completed.length}.
                    </Caption>
                  </>
                ) : null}
              </Card>
            </View>
          </>
        )}
      </Screen>
    </>
  );
}

function BreakdownCard({
  title,
  rows,
  max,
}: {
  title: string;
  rows: Breakdown[];
  max: number;
}) {
  if (rows.length === 0) return null;

  return (
    <View>
      <SectionHeading title={title} />
      <Card>
        <View style={{ gap: spacing.md }}>
          {rows.map((row) => (
            <View key={row.key} style={{ gap: 5 }}>
              <Row justify="space-between">
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {row.label}
                </Text>
                <Text style={styles.rowValue}>{formatWeight(row.weightKg)}</Text>
              </Row>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    { width: `${max > 0 ? Math.max(2, (row.weightKg / max) * 100) : 0}%` },
                  ]}
                />
              </View>
              <Caption>
                {row.jobs} {row.jobs === 1 ? 'job' : 'jobs'}
                {row.value !== null ? ` · $${row.value.toFixed(2)}` : ''}
              </Caption>
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}

/** All aggregation is client-side — fine at this scale, and it keeps the API
 *  surface small. If job volume ever outgrows a single page, move this to a
 *  `/reports` endpoint and keep the same shapes. */
function summarise(
  jobs: Job[],
  rates: Map<string, number>,
): {
  weightKg: number;
  value: number | null;
  byMaterial: Breakdown[];
  byCustomer: Breakdown[];
} {
  const materials = new Map<string, Breakdown>();
  const customers = new Map<string, Breakdown>();
  let weightKg = 0;
  let value = 0;
  let anyRate = false;

  for (const job of jobs) {
    weightKg += job.totalWeightKg;

    const customerKey = job.customerId ?? job.customerName ?? 'unknown';
    const customer = customers.get(customerKey) ?? {
      key: customerKey,
      label: job.customerName ?? 'No customer',
      weightKg: 0,
      jobs: 0,
      value: null,
    };
    customer.weightKg += job.totalWeightKg;
    customer.jobs += 1;

    for (const line of job.lines) {
      const material = materials.get(line.materialId) ?? {
        key: line.materialId,
        label: line.materialName,
        weightKg: 0,
        jobs: 0,
        value: null,
      };
      material.weightKg += line.weightKg;
      material.jobs += 1;

      const rate = rates.get(line.materialId);
      if (rate !== undefined) {
        anyRate = true;
        const lineValue = line.weightKg * rate;
        value += lineValue;
        material.value = (material.value ?? 0) + lineValue;
        customer.value = (customer.value ?? 0) + lineValue;
      }
      materials.set(line.materialId, material);
    }

    customers.set(customerKey, customer);
  }

  const round = (n: number) => Number(n.toFixed(2));
  const sorted = (map: Map<string, Breakdown>) =>
    [...map.values()]
      .map((row) => ({
        ...row,
        weightKg: round(row.weightKg),
        value: row.value === null ? null : round(row.value),
      }))
      .sort((a, b) => b.weightKg - a.weightKg)
      .slice(0, 8);

  return {
    weightKg: round(weightKg),
    // Null rather than $0.00 when no material has a rate — a zero would read
    // as "this material is worthless" instead of "nobody set a price".
    value: anyRate ? round(value) : null,
    byMaterial: sorted(materials),
    byCustomer: sorted(customers),
  };
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rowLabel: { ...typography.body, color: colors.ink, flex: 1, marginRight: spacing.md },
  rowValue: { ...typography.bodyStrong, color: colors.ink },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.slateSoft,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.green },
  exportTitle: { ...typography.bodyStrong, color: colors.ink },
  jobRow: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md },
  jobRef: { ...typography.body, color: colors.ink },
  jobWeight: { ...typography.bodyStrong, color: colors.ink },
});
