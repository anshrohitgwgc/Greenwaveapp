import { StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Button,
  Caption,
  Card,
  Divider,
  EmptyState,
  Row,
  Screen,
  SectionHeading,
} from '@/components/ui';
import { useOffline } from '@/offline/provider';
import { describeOp } from '@/offline/queue';
import { colors, spacing, typography } from '@/theme';
import { formatRelative } from '@/utils/format';
import { confirm } from '@/utils/dialogs';

export default function SyncScreen() {
  const { online, pending, failures, sync, syncing, clearFailures } = useOffline();

  async function discard() {
    const ok = await confirm({
      title: `Discard ${failures.length} failed change${failures.length === 1 ? '' : 's'}?`,
      message:
        "They will not be sent, and won't appear on the job. You'll need to record them again.",
      confirmLabel: 'Discard',
      destructive: true,
    });
    if (ok) await clearFailures();
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Pending changes' }} />
      <Screen>
        <Card style={online ? undefined : styles.offlineCard}>
          <Row gap={spacing.md}>
            <Ionicons
              name={online ? 'cloud-done-outline' : 'cloud-offline-outline'}
              size={22}
              color={online ? colors.greenDark : colors.amber}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.stateTitle}>{online ? 'Connected' : 'No connection'}</Text>
              <Caption>
                {online
                  ? pending.length === 0
                    ? 'Everything on this phone has been sent.'
                    : 'Sending your saved work now.'
                  : 'Everything you record is saved on this phone and sent automatically when signal returns.'}
              </Caption>
            </View>
          </Row>
          {online && pending.length > 0 ? (
            <Button
              label={syncing ? 'Sending…' : 'Send now'}
              icon="cloud-upload-outline"
              loading={syncing}
              onPress={() => void sync()}
              style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
              size="sm"
            />
          ) : null}
        </Card>

        {pending.length > 0 ? (
          <View>
            <SectionHeading title={`Waiting to send (${pending.length})`} />
            <Card padded={false}>
              {pending.map((entry, index) => (
                <View key={entry.id}>
                  {index > 0 ? <Divider /> : null}
                  <Row gap={spacing.md} style={styles.row}>
                    <View style={styles.dot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.opText}>{describeOp(entry.op)}</Text>
                      <Caption>
                        Recorded {formatRelative(entry.createdAt)}
                        {entry.attempts > 0
                          ? ` · ${entry.attempts} attempt${entry.attempts === 1 ? '' : 's'}`
                          : ''}
                      </Caption>
                    </View>
                  </Row>
                </View>
              ))}
            </Card>
            <Caption style={{ marginTop: spacing.sm }}>
              These are sent in the order you recorded them, so a weight always lands before
              the job is marked complete.
            </Caption>
          </View>
        ) : null}

        {failures.length > 0 ? (
          <View>
            <SectionHeading title={`Couldn't be saved (${failures.length})`} />
            <Card padded={false}>
              {failures.map((failure, index) => (
                <View key={failure.id}>
                  {index > 0 ? <Divider /> : null}
                  <Row gap={spacing.md} style={styles.row} align="flex-start">
                    <Ionicons
                      name="alert-circle"
                      size={18}
                      color={colors.red}
                      style={{ marginTop: 2 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.opText}>{describeOp(failure.op)}</Text>
                      <Caption>{failure.reason}</Caption>
                    </View>
                  </Row>
                </View>
              ))}
            </Card>
            <Button
              label="Discard these"
              variant="danger"
              onPress={discard}
              style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
              size="sm"
            />
          </View>
        ) : null}

        {pending.length === 0 && failures.length === 0 ? (
          <Card>
            <EmptyState
              icon="checkmark-done-outline"
              title="Nothing waiting"
              message="Every weight, photo and status change you've recorded has reached the server."
            />
          </Card>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  offlineCard: { backgroundColor: colors.amberSoft, borderColor: colors.amber },
  stateTitle: { ...typography.bodyStrong, color: colors.ink },
  row: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  opText: { ...typography.body, color: colors.ink },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.amber,
  },
});
