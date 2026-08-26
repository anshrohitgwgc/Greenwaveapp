import { useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import {
  Button,
  Caption,
  Card,
  InlineError,
  Screen,
  Select,
  TextField,
} from '@/components/ui';
import { useCreateStaff } from '@/api/queries';
import { spacing } from '@/theme';
import { isValidEmail } from '@/utils/format';
import { notify } from '@/utils/dialogs';
import type { Role } from '@/api/types';

const ROLE_OPTIONS: { value: Role; label: string; sublabel: string }[] = [
  { value: 'driver', label: 'Driver', sublabel: 'Sees and completes their own jobs' },
  { value: 'manager', label: 'Manager', sublabel: 'Schedules work and sees everyone' },
  { value: 'admin', label: 'Administrator', sublabel: 'Full access, including staff accounts' },
];

export default function NewStaffScreen() {
  const router = useRouter();
  const createStaff = useCreateStaff();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('driver');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  async function submit() {
    setError(null);

    const next: Record<string, string | undefined> = {};
    if (!fullName.trim()) next.fullName = 'Enter their full name.';
    if (!email.trim()) next.email = 'Enter their work email.';
    else if (!isValidEmail(email)) next.email = "That doesn't look like an email address.";
    if (password.length < 8) next.password = 'Use at least 8 characters.';

    setFieldErrors(next);
    if (Object.values(next).some(Boolean)) return;

    try {
      await createStaff.mutateAsync({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || null,
        role,
        password,
      });
      notify(
        'Staff member added',
        `${fullName.trim()} can now sign in with ${email.trim().toLowerCase()} and the password you set. Ask them to change it after their first login.`,
      );
      router.back();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : 'Could not create that account.',
      );
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Add staff' }} />
      <Screen>
        <Card>
          <View style={{ gap: spacing.lg }}>
            <TextField
              label="Full name"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Marcus Lee"
              autoCapitalize="words"
              error={fieldErrors.fullName}
            />

            <TextField
              label="Work email"
              value={email}
              onChangeText={setEmail}
              placeholder="marcus@gwgc.cloud"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              inputMode="email"
              error={fieldErrors.email}
              hint="This is the only email that will be able to sign in for them."
            />

            <TextField
              label="Phone (optional)"
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 604 555 0100"
              keyboardType="phone-pad"
              inputMode="tel"
            />

            <Select<Role>
              label="Role"
              value={role}
              options={ROLE_OPTIONS}
              onChange={setRole}
            />

            <TextField
              label="Initial password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              error={fieldErrors.password}
              hint="Share this with them privately. They should change it after signing in."
            />
          </View>
        </Card>

        <InlineError message={error} />

        <View style={{ gap: spacing.sm }}>
          <Button
            label="Create account"
            size="lg"
            fullWidth
            loading={createStaff.isPending}
            onPress={submit}
          />
          <Button label="Cancel" variant="ghost" fullWidth onPress={() => router.back()} />
          <Caption style={{ textAlign: 'center' }}>
            Only administrators can add or deactivate staff accounts.
          </Caption>
        </View>
      </Screen>
    </>
  );
}
