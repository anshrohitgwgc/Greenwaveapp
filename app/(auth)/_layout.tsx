import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/auth/store';

export default function AuthLayout() {
  const status = useAuth((state) => state.status);

  if (status === 'signed-in') return <Redirect href="/(app)/(tabs)" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
