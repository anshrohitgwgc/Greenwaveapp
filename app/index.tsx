import { Redirect } from 'expo-router';
import { useAuth } from '@/auth/store';
import { Loading } from '@/components/ui';

/** Entry point: decide where an opening app should land. */
export default function Index() {
  const status = useAuth((state) => state.status);

  if (status === 'loading') return <Loading label="Signing you in…" />;
  if (status === 'signed-in') return <Redirect href="/(app)/(tabs)" />;
  return <Redirect href="/(auth)/login" />;
}
