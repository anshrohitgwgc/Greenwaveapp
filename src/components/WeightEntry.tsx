import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Button,
  Caption,
  Divider,
  InlineError,
  Row,
  Select,
  TextField,
} from './ui';
import { colors, radius, spacing, typography } from '@/theme';
import { useAddJobLine, useDeleteJobLine, useMaterials } from '@/api/queries';
import { isLocalId } from '@/offline/optimistic';
import { formatWeight, parseWeight } from '@/utils/format';
import { confirm } from '@/utils/dialogs';
import type { JobLine } from '@/api/types';

export function WeightEntry({
  jobId,
  lines,
  totalKg,
  editable = true,
}: {
  jobId: string;
  lines: JobLine[];
  totalKg: number;
  editable?: boolean;
}) {
  const { data: materials = [], isLoading: materialsLoading } = useMaterials();
  const addLine = useAddJobLine(jobId);
  const deleteLine = useDeleteJobLine(jobId);

  const [materialId, setMaterialId] = useState<string | null>(null);
  const [weight, setWeight] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () =>
      materials.map((material) => ({
        value: material.id,
        label: material.name,
        sublabel: material.category ?? undefined,
      })),
    [materials],
  );

  async function add() {
    setError(null);

    if (!materialId) {
      setError('Choose a material first.');
      return;
    }
    const kg = parseWeight(weight);
    if (kg === null) {
      setError('Enter a weight in kilograms, for example 340.5');
      return;
    }

    try {
      await addLine.mutateAsync({
        materialId,
        weightKg: kg,
        notes: note.trim() || null,
      });
      setWeight('');
      setNote('');
      // Material stays selected — most loads are several bags of the same thing.
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Could not save that entry.');
    }
  }

  async function remove(line: JobLine) {
    const ok = await confirm({
      title: `Remove ${line.materialName}?`,
      message: `${formatWeight(line.weightKg)} will be taken off this job.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await deleteLine.mutateAsync(line.id);
  }

  return (
    <View style={{ gap: spacing.md }}>
      {lines.length === 0 ? (
        <Caption>No materials recorded yet.</Caption>
      ) : (
        <View style={styles.lines}>
          {lines.map((line, index) => (
            <View key={line.id}>
              {index > 0 ? <Divider /> : null}
              <Row justify="space-between" style={styles.line}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.material}>{line.materialName}</Text>
                  {line.notes ? (
                    <Text style={styles.note} numberOfLines={2}>
                      {line.notes}
                    </Text>
                  ) : null}
                  {isLocalId(line.id) ? (
                    <Row gap={4} style={{ marginTop: 2 }}>
                      <Ionicons name="cloud-upload-outline" size={11} color={colors.amber} />
                      <Text style={styles.pending}>Saved here — not sent yet</Text>
                    </Row>
                  ) : null}
                </View>
                <Row gap={spacing.md}>
                  <Text style={styles.weight}>{formatWeight(line.weightKg)}</Text>
                  {editable ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${line.materialName}`}
                      onPress={() => remove(line)}
                      hitSlop={10}
                    >
                      <Ionicons name="close-circle" size={20} color={colors.muted} />
                    </Pressable>
                  ) : null}
                </Row>
              </Row>
            </View>
          ))}

          <Divider />
          <Row justify="space-between" style={styles.line}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatWeight(totalKg)}</Text>
          </Row>
        </View>
      )}

      {editable ? (
        <View style={styles.form}>
          <Select
            label="Material"
            placeholder={materialsLoading ? 'Loading materials…' : 'Choose a material'}
            value={materialId}
            options={options}
            onChange={setMaterialId}
          />

          <Row gap={spacing.md} align="flex-end">
            <TextField
              label="Weight (kg)"
              value={weight}
              onChangeText={setWeight}
              placeholder="0.0"
              keyboardType="decimal-pad"
              inputMode="decimal"
              returnKeyType="done"
              containerStyle={{ flex: 1 }}
            />
            <Button
              label="Add"
              icon="add"
              onPress={add}
              loading={addLine.isPending}
              style={{ minWidth: 96 }}
            />
          </Row>

          <TextField
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="e.g. two bulk bags, wet load"
          />

          <InlineError message={error} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lines: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  line: { paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  material: { ...typography.bodyStrong, color: colors.ink },
  note: { ...typography.small, color: colors.muted },
  pending: { ...typography.small, fontSize: 11, color: colors.amber, fontWeight: '600' },
  weight: { ...typography.bodyStrong, color: colors.ink },
  totalLabel: { ...typography.smallStrong, color: colors.muted, letterSpacing: 0.3 },
  totalValue: { ...typography.heading, color: colors.greenDark },
  form: { gap: spacing.md },
});
