import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Button,
  Caption,
  Card,
  Chip,
  InlineError,
  Row,
  Screen,
  SectionHeading,
  Segmented,
  Select,
  TextField,
} from '@/components/ui';
import { useCreateJob, useCustomers, useJob, useStaff, useUpdateJob } from '@/api/queries';
import { spacing } from '@/theme';
import { toDateKey, toIso } from '@/utils/format';
import type { JobType } from '@/api/types';

const TIME_PRESETS = ['07:00', '08:00', '09:00', '11:00', '13:00', '15:00'];

export default function JobFormScreen() {
  const router = useRouter();
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const isEditing = Boolean(editId);

  const existing = useJob(editId);
  const customers = useCustomers();
  const staff = useStaff();
  const createJob = useCreateJob();
  const updateJob = useUpdateJob(editId ?? '');

  const [type, setType] = useState<JobType>('pickup');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [dateKey, setDateKey] = useState(toDateKey());
  const [time, setTime] = useState('09:00');
  const [assignedToId, setAssignedToId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Prefill when editing.
  useEffect(() => {
    const job = existing.data;
    if (!job || !isEditing) return;
    setType(job.type);
    setCustomerId(job.customerId);
    setAddress(job.address ?? '');
    const scheduled = new Date(job.scheduledFor);
    setDateKey(toDateKey(scheduled));
    setTime(
      `${String(scheduled.getHours()).padStart(2, '0')}:${String(
        scheduled.getMinutes(),
      ).padStart(2, '0')}`,
    );
    setAssignedToId(job.assignedToId);
    setNotes(job.notes ?? '');
  }, [existing.data, isEditing]);

  const customerOptions = useMemo(
    () =>
      (customers.data ?? []).map((customer) => ({
        value: customer.id,
        label: customer.name,
        sublabel: customer.address ?? undefined,
      })),
    [customers.data],
  );

  const staffOptions = useMemo(
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

  const dateChips = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    for (let offset = 0; offset < 4; offset += 1) {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      const key = toDateKey(date);
      const label =
        offset === 0
          ? 'Today'
          : offset === 1
            ? 'Tomorrow'
            : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
      chips.push({ key, label });
    }
    return chips;
  }, []);

  const submitting = createJob.isPending || updateJob.isPending;

  async function submit() {
    setError(null);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      setError('Enter the date as YYYY-MM-DD.');
      return;
    }
    if (!/^\d{1,2}:\d{2}$/.test(time)) {
      setError('Enter the time as HH:MM, for example 09:30.');
      return;
    }
    if (!customerId && !address.trim()) {
      setError('Pick a customer or type an address so the driver knows where to go.');
      return;
    }

    const payload = {
      type,
      customerId,
      address: address.trim() || null,
      scheduledFor: toIso(dateKey, time),
      assignedToId,
      notes: notes.trim() || null,
    };

    try {
      if (isEditing) {
        await updateJob.mutateAsync(payload);
        router.back();
      } else {
        const job = await createJob.mutateAsync(payload);
        router.replace({ pathname: '/(app)/job/[id]', params: { id: job.id } });
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Could not save the job.',
      );
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: isEditing ? 'Edit job' : 'New job' }} />
      <Screen>
        <Card>
          <View style={{ gap: spacing.lg }}>
            <View style={{ gap: spacing.sm }}>
              <SectionHeading title="Job type" />
              <Segmented<JobType>
                value={type}
                onChange={setType}
                options={[
                  { value: 'pickup', label: 'Pickup' },
                  { value: 'dropoff', label: 'Dropoff' },
                ]}
              />
            </View>

            <Select
              label="Customer"
              placeholder={customers.isLoading ? 'Loading customers…' : 'Choose a customer'}
              value={customerId}
              options={customerOptions}
              onChange={(value) => {
                setCustomerId(value);
                const chosen = customers.data?.find((customer) => customer.id === value);
                if (chosen?.address && !address.trim()) setAddress(chosen.address);
              }}
            />

            <TextField
              label="Address"
              value={address}
              onChangeText={setAddress}
              placeholder="Street, city"
              hint="Filled in from the customer, but you can override it."
            />
          </View>
        </Card>

        <Card>
          <View style={{ gap: spacing.lg }}>
            <View style={{ gap: spacing.sm }}>
              <SectionHeading title="When" />
              <Row gap={spacing.sm} wrap>
                {dateChips.map((chip) => (
                  <Chip
                    key={chip.key}
                    label={chip.label}
                    active={dateKey === chip.key}
                    onPress={() => setDateKey(chip.key)}
                  />
                ))}
              </Row>
            </View>

            <Row gap={spacing.md} align="flex-start">
              <TextField
                label="Date"
                value={dateKey}
                onChangeText={setDateKey}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
                autoCorrect={false}
                containerStyle={{ flex: 1 }}
              />
              <TextField
                label="Time"
                value={time}
                onChangeText={setTime}
                placeholder="HH:MM"
                autoCapitalize="none"
                autoCorrect={false}
                containerStyle={{ flex: 1 }}
              />
            </Row>

            <Row gap={spacing.sm} wrap>
              {TIME_PRESETS.map((preset) => (
                <Chip
                  key={preset}
                  label={preset}
                  active={time === preset}
                  onPress={() => setTime(preset)}
                />
              ))}
            </Row>
          </View>
        </Card>

        <Card>
          <View style={{ gap: spacing.lg }}>
            <Select
              label="Assign to"
              placeholder="Leave unassigned for now"
              value={assignedToId}
              options={staffOptions}
              onChange={setAssignedToId}
            />
            <TextField
              label="Notes for the driver"
              value={notes}
              onChangeText={setNotes}
              placeholder="Gate code, contact on site, bin location…"
              multiline
            />
          </View>
        </Card>

        <InlineError message={error} />

        <View style={styles.actions}>
          <Button
            label={isEditing ? 'Save changes' : 'Create job'}
            size="lg"
            fullWidth
            loading={submitting}
            onPress={submit}
          />
          <Button label="Cancel" variant="ghost" fullWidth onPress={() => router.back()} />
          <Caption style={{ textAlign: 'center' }}>
            {assignedToId
              ? 'The job is created as Assigned.'
              : 'Unassigned jobs stay in Scheduled until you pick a driver.'}
          </Caption>
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
});
