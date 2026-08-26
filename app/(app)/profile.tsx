import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import {
  Avatar,
  Badge,
  Button,
  Caption,
  Card,
  Divider,
  InlineError,
  Row,
  Screen,
  SectionHeading,
  TextField,
} from '@/components/ui';
import { useChangePassword } from '@/api/queries';
import { useCurrentUser } from '@/auth/store';
import { colors, spacing, typography } from '@/theme';
import { notify } from '@/utils/dialogs';
import type { Role } from '@/api/types';

const roleLabel: Record<Role, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  driver: 'Driver',
};

export default function ProfileScreen() {
  const user = useCurrentUser();
  const changePassword = useChangePassword();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  async function submit() {
    setError(null);

    const errors: Record<string, string | undefined> = {};
    if (!current) errors.current = 'Enter your current password.';
    if (next.length < 8) errors.next = 'Use at least 8 characters.';
    if (next && next === current) errors.next = 'Choose a password you have not used here before.';
    if (confirmValue !== next) errors.confirm = "This doesn't match the new password.";

    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    try {
      await changePassword.mutateAsync({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirmValue('');
      notify('Password changed', 'Use your new password the next time you sign in.');
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : 'Could not change your password.',
      );
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Your account' }} />
      <Screen>
        <Card>
          <Row gap={spacing.md}>
            <Avatar name={user?.fullName ?? '?'} size={52} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{user?.fullName}</Text>
              <Caption>{user?.email}</Caption>
              {user?.phone ? <Caption>{user.phone}</Caption> : null}
            </View>
          </Row>
          <Divider style={{ marginVertical: spacing.md }} />
          <Row justify="space-between">
            <Caption>Role</Caption>
            <Badge
              label={roleLabel[user?.role ?? 'driver']}
              fg={colors.navy}
              bg={colors.waveSoft}
            />
          </Row>
          <Caption>
            Only an administrator can change your name, email or role. Ask them if any of it is
            wrong.
          </Caption>
        </Card>

        <View>
          <SectionHeading title="Change password" />
          <Card>
            <View style={{ gap: spacing.md }}>
              <Caption>
                If an administrator set your password for you, change it here so only you know
                it.
              </Caption>

              <TextField
                label="Current password"
                value={current}
                onChangeText={(value) => {
                  setCurrent(value);
                  setFieldErrors((prev) => ({ ...prev, current: undefined }));
                }}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                error={fieldErrors.current}
              />

              <TextField
                label="New password"
                value={next}
                onChangeText={(value) => {
                  setNext(value);
                  setFieldErrors((prev) => ({ ...prev, next: undefined }));
                }}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                error={fieldErrors.next}
                hint="At least 8 characters."
              />

              <TextField
                label="Confirm new password"
                value={confirmValue}
                onChangeText={(value) => {
                  setConfirmValue(value);
                  setFieldErrors((prev) => ({ ...prev, confirm: undefined }));
                }}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                error={fieldErrors.confirm}
              />

              <InlineError message={error} />

              <Button
                label="Change password"
                onPress={submit}
                loading={changePassword.isPending}
                fullWidth
              />
            </View>
          </Card>
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  name: { ...typography.title, color: colors.ink },
});
