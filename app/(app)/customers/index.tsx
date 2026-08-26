import { useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Button,
  Caption,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Loading,
  Row,
  Screen,
  SectionHeading,
  TextField,
} from '@/components/ui';
import { useCustomers } from '@/api/queries';
import { useCanManage } from '@/auth/store';
import { colors, spacing, typography } from '@/theme';

export default function CustomersScreen() {
  const router = useRouter();
  const canManage = useCanManage();
  const [search, setSearch] = useState('');

  const customers = useCustomers(search.trim() || undefined);
  const items = customers.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Customers' }} />
      <Screen
        refreshControl={
          <RefreshControl
            refreshing={customers.isRefetching}
            onRefresh={() => void customers.refetch()}
          />
        }
      >
        <TextField
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or address"
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="search"
        />

        {canManage ? (
          <Button
            label="Add customer"
            icon="add"
            onPress={() => router.push('/(app)/customers/new')}
            fullWidth
          />
        ) : null}

        {customers.isLoading ? (
          <Loading label="Loading customers…" />
        ) : customers.isError ? (
          <ErrorState error={customers.error} onRetry={() => void customers.refetch()} />
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon="business-outline"
              title={search ? 'No customers match that' : 'No customers yet'}
              message={
                search
                  ? 'Try a different name or address.'
                  : 'Add the sites you collect from so jobs can be booked against them.'
              }
            />
          </Card>
        ) : (
          <View>
            <SectionHeading title={`${items.length} ${items.length === 1 ? 'customer' : 'customers'}`} />
            <Card padded={false}>
              {items.map((customer, index) => (
                <View key={customer.id}>
                  {index > 0 ? <Divider /> : null}
                  <Row gap={spacing.md} style={styles.row}>
                    <View style={styles.icon}>
                      <Ionicons name="business-outline" size={17} color={colors.navy} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {customer.name}
                      </Text>
                      {customer.address ? (
                        <Caption numberOfLines={1}>{customer.address}</Caption>
                      ) : null}
                      {customer.contactName || customer.contactPhone ? (
                        <Caption numberOfLines={1}>
                          {[customer.contactName, customer.contactPhone]
                            .filter(Boolean)
                            .join(' · ')}
                        </Caption>
                      ) : null}
                    </View>
                    {canManage ? (
                      <Text
                        accessibilityRole="button"
                        onPress={() =>
                          router.push({
                            pathname: '/(app)/customers/new',
                            params: { editId: customer.id },
                          })
                        }
                        style={styles.edit}
                      >
                        Edit
                      </Text>
                    ) : null}
                  </Row>
                </View>
              ))}
            </Card>
          </View>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...typography.bodyStrong, color: colors.ink },
  edit: { ...typography.smallStrong, color: colors.wave },
});
