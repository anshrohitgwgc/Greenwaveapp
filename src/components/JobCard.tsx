import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Row } from './ui';
import { colors, radius, shadow, spacing, statusMeta, typeMeta, typography } from '@/theme';
import { formatDayTime, formatWeight } from '@/utils/format';
import type { Job } from '@/api/types';

export function JobCard({ job, onPress }: { job: Job; onPress: () => void }) {
  const type = typeMeta[job.type];
  const status = statusMeta[job.status];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${type.label} ${job.reference} for ${job.customerName ?? 'unassigned customer'}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <Row justify="space-between" align="flex-start">
        <Row gap={spacing.sm}>
          <View style={[styles.typeDot, { backgroundColor: `${type.tint}1A` }]}>
            <Ionicons name={type.icon as never} size={16} color={type.tint} />
          </View>
          <View>
            <Text style={styles.reference}>{job.reference}</Text>
            <Text style={styles.type}>{type.label}</Text>
          </View>
        </Row>
        <Badge label={status.label} fg={status.fg} bg={status.bg} />
      </Row>

      <Text style={styles.customer} numberOfLines={1}>
        {job.customerName ?? 'No customer set'}
      </Text>
      {job.address ? (
        <Text style={styles.address} numberOfLines={1}>
          {job.address}
        </Text>
      ) : null}

      <View style={styles.footer}>
        <Row gap={spacing.xs}>
          <Ionicons name="time-outline" size={14} color={colors.muted} />
          <Text style={styles.meta}>{formatDayTime(job.scheduledFor)}</Text>
        </Row>

        <Row gap={spacing.lg}>
          {job.totalWeightKg > 0 ? (
            <Row gap={spacing.xs}>
              <Ionicons name="scale-outline" size={14} color={colors.muted} />
              <Text style={styles.meta}>{formatWeight(job.totalWeightKg)}</Text>
            </Row>
          ) : null}
          {job.photos.length > 0 ? (
            <Row gap={spacing.xs}>
              <Ionicons name="camera-outline" size={14} color={colors.muted} />
              <Text style={styles.meta}>{job.photos.length}</Text>
            </Row>
          ) : null}
          {job.assignedToName ? (
            <Row gap={spacing.xs}>
              <Ionicons name="person-outline" size={14} color={colors.muted} />
              <Text style={styles.meta} numberOfLines={1}>
                {job.assignedToName.split(' ')[0]}
              </Text>
            </Row>
          ) : (
            <Text style={[styles.meta, { color: colors.amber }]}>Unassigned</Text>
          )}
        </Row>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow,
  },
  typeDot: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reference: { ...typography.bodyStrong, color: colors.ink },
  type: { ...typography.small, color: colors.muted },
  customer: { ...typography.body, color: colors.ink, fontWeight: '600' },
  address: { ...typography.small, color: colors.body },
  footer: {
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: spacing.sm,
  },
  meta: { ...typography.small, color: colors.muted },
});
