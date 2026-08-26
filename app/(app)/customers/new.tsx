import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Button,
  Caption,
  Card,
  InlineError,
  Screen,
  TextField,
} from '@/components/ui';
import { useCreateCustomer, useCustomers, useUpdateCustomer } from '@/api/queries';
import { spacing } from '@/theme';

export default function CustomerFormScreen() {
  const router = useRouter();
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const isEditing = Boolean(editId);

  const customers = useCustomers();
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();

  useEffect(() => {
    if (!isEditing) return;
    const existing = customers.data?.find((customer) => customer.id === editId);
    if (!existing) return;
    setName(existing.name);
    setAddress(existing.address ?? '');
    setContactName(existing.contactName ?? '');
    setContactPhone(existing.contactPhone ?? '');
    setNotes(existing.notes ?? '');
  }, [customers.data, editId, isEditing]);

  async function submit() {
    setError(null);

    if (!name.trim()) {
      setNameError('Enter the customer or site name.');
      return;
    }
    setNameError(undefined);

    const payload = {
      name: name.trim(),
      address: address.trim() || null,
      contactName: contactName.trim() || null,
      contactPhone: contactPhone.trim() || null,
      notes: notes.trim() || null,
    };

    try {
      if (isEditing && editId) {
        await updateCustomer.mutateAsync({ customerId: editId, input: payload });
      } else {
        await createCustomer.mutateAsync(payload);
      }
      router.back();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Could not save that customer.',
      );
    }
  }

  const submitting = createCustomer.isPending || updateCustomer.isPending;

  return (
    <>
      <Stack.Screen options={{ title: isEditing ? 'Edit customer' : 'Add customer' }} />
      <Screen>
        <Card>
          <View style={{ gap: spacing.lg }}>
            <TextField
              label="Name"
              value={name}
              onChangeText={(value) => {
                setName(value);
                setNameError(undefined);
              }}
              placeholder="Harbour Foods Ltd"
              autoCapitalize="words"
              error={nameError}
            />
            <TextField
              label="Address"
              value={address}
              onChangeText={setAddress}
              placeholder="1420 Commissioner St, Vancouver"
              hint="Used as the default address when a job is booked here."
            />
            <TextField
              label="Contact name"
              value={contactName}
              onChangeText={setContactName}
              placeholder="Rita Chen"
              autoCapitalize="words"
            />
            <TextField
              label="Contact phone"
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="+1 604 555 0200"
              keyboardType="phone-pad"
              inputMode="tel"
            />
            <TextField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Gate code, bin location, access hours…"
              multiline
            />
          </View>
        </Card>

        <InlineError message={error} />

        <View style={{ gap: spacing.sm }}>
          <Button
            label={isEditing ? 'Save changes' : 'Add customer'}
            size="lg"
            fullWidth
            loading={submitting}
            onPress={submit}
          />
          <Button label="Cancel" variant="ghost" fullWidth onPress={() => router.back()} />
          <Caption style={{ textAlign: 'center' }}>
            Customers appear in the picker when scheduling a pickup or dropoff.
          </Caption>
        </View>
      </Screen>
    </>
  );
}
