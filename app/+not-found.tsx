import { Stack, useRouter } from 'expo-router';
import { Button, EmptyState, Screen } from '@/components/ui';

export default function NotFoundScreen() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Screen scroll={false}>
        <EmptyState
          icon="help-circle-outline"
          title="That screen doesn't exist"
          message="The link you followed points somewhere GreenWave doesn't have."
          action={
            <Button label="Go to Today" onPress={() => router.replace('/(app)/(tabs)')} />
          }
        />
      </Screen>
    </>
  );
}
