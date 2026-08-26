/**
 * A thin strip under the header telling the driver exactly where their work is.
 *
 * Three states, three different meanings — never collapse them into one
 * "something's wrong" message:
 *   offline with queued work  -> saved here, will send
 *   online and sending        -> sending now
 *   failed                    -> needs a human
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOffline } from '@/offline/provider';
import { colors, spacing, typography } from '@/theme';

export function OfflineBanner() {
  const router = useRouter();
  const { online, pending, failures, syncing } = useOffline();

  const hasFailures = failures.length > 0;
  const hasPending = pending.length > 0;

  if (online && !hasPending && !hasFailures) return null;

  const state = hasFailures
    ? {
        bg: colors.redSoft,
        fg: colors.red,
        icon: 'alert-circle' as const,
        text: `${failures.length} change${failures.length === 1 ? '' : 's'} couldn't be saved`,
      }
    : !online
      ? {
          bg: colors.amberSoft,
          fg: colors.amber,
          icon: 'cloud-offline' as const,
          text: hasPending
            ? `Offline · ${pending.length} change${pending.length === 1 ? '' : 's'} waiting to send`
            : 'Offline · your work is saved on this phone',
        }
      : {
          bg: colors.blueSoft,
          fg: colors.blue,
          icon: 'cloud-upload' as const,
          text: syncing
            ? `Sending ${pending.length} change${pending.length === 1 ? '' : 's'}…`
            : `${pending.length} change${pending.length === 1 ? '' : 's'} waiting to send`,
        };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${state.text}. Open pending changes.`}
      onPress={() => router.push('/(app)/sync')}
      style={[styles.bar, { backgroundColor: state.bg }]}
    >
      <Ionicons name={state.icon} size={15} color={state.fg} />
      <Text style={[styles.text, { color: state.fg }]} numberOfLines={1}>
        {state.text}
      </Text>
      <Ionicons name="chevron-forward" size={14} color={state.fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  text: { ...typography.smallStrong, flex: 1 },
});
