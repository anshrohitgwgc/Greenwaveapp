import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Caption, InlineError, Row, TextField } from '@/components/ui';
import { useAuth } from '@/auth/store';
import { config } from '@/api/config';
import { colors, radius, shadow, spacing, typography } from '@/theme';
import { isValidEmail } from '@/utils/format';

export default function LoginScreen() {
  const signIn = useAuth((state) => state.signIn);
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  async function submit() {
    setError(null);

    const nextFieldErrors: typeof fieldErrors = {};
    if (!email.trim()) nextFieldErrors.email = 'Enter your work email.';
    else if (!isValidEmail(email)) nextFieldErrors.email = "That doesn't look like an email address.";
    if (!password) nextFieldErrors.password = 'Enter your password.';

    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) return;

    setSubmitting(true);
    try {
      await signIn(email, password);
      // The (auth) layout redirects once status flips to signed-in.
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : 'Could not sign you in. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Ionicons name="leaf" size={26} color={colors.white} />
          </View>
          <Text style={styles.brandName}>GreenWave</Text>
          <Text style={styles.brandTag}>Pickups, dropoffs and materials — in one place.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign in</Text>
          <Caption>Use the work email your administrator registered for you.</Caption>

          <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
            <TextField
              label="Work email"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }}
              placeholder="you@gwgc.cloud"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              inputMode="email"
              returnKeyType="next"
              error={fieldErrors.email}
            />

            <View>
              <TextField
                label="Password"
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  if (fieldErrors.password) {
                    setFieldErrors((prev) => ({ ...prev, password: undefined }));
                  }
                }}
                placeholder="••••••••"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={submit}
                error={fieldErrors.password}
              />
              <Text
                accessibilityRole="button"
                onPress={() => setShowPassword((prev) => !prev)}
                style={styles.reveal}
              >
                {showPassword ? 'Hide' : 'Show'}
              </Text>
            </View>

            <InlineError message={error} />

            <Button
              label="Sign in"
              onPress={submit}
              loading={submitting}
              size="lg"
              fullWidth
            />
          </View>

          <Row gap={spacing.sm} align="flex-start" style={styles.helpRow}>
            <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
            <Caption style={{ flex: 1 }}>
              Only emails in the GreenWave staff database can sign in. If yours is rejected, ask
              your administrator to add it.
            </Caption>
          </Row>
        </View>

        {config.useMock ? (
          <View style={styles.demo}>
            <Text style={styles.demoTitle}>DEMO MODE — no backend connected</Text>
            <Caption>Any password works. Try:</Caption>
            <Caption>admin@gwgc.cloud · manager@gwgc.cloud · driver@gwgc.cloud</Caption>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
    maxWidth: 460,
    width: '100%',
    alignSelf: 'center',
  },
  brand: { alignItems: 'center', gap: spacing.sm },
  logo: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: { ...typography.display, color: colors.ink },
  brandTag: {
    ...typography.small,
    color: colors.body,
    textAlign: 'center',
    maxWidth: 300,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.xl,
    ...shadow,
  },
  cardTitle: { ...typography.title, color: colors.ink, marginBottom: spacing.xs },
  reveal: {
    position: 'absolute',
    right: spacing.md,
    top: 30,
    ...typography.smallStrong,
    color: colors.wave,
  },
  helpRow: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  demo: {
    backgroundColor: colors.amberSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  demoTitle: { ...typography.micro, color: colors.amber },
});
