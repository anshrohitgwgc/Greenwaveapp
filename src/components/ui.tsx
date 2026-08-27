/**
 * The GreenWave UI kit. Small, unstyled-by-default primitives that all three
 * platforms share. No platform forks except where behaviour genuinely differs.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type RefreshControlProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CONTENT_MAX_WIDTH, colors, radius, shadow, spacing, typography } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
  padded = true,
  refreshControl,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const inner = (
    <View style={[styles.contentColumn, padded && styles.contentPadded, contentStyle]}>
      {children}
    </View>
  );

  if (!scroll) {
    return <View style={styles.screen}>{inner}</View>;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {inner}
    </ScrollView>
  );
}

export function Card({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  return (
    <View style={[styles.card, padded && { padding: spacing.lg }, style]}>{children}</View>
  );
}

export function Row({
  children,
  gap = spacing.sm,
  align = 'center',
  justify = 'flex-start',
  wrap = false,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: align,
          justifyContent: justify,
          gap,
          flexWrap: wrap ? 'wrap' : 'nowrap',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Spacer({ size = spacing.lg }: { size?: number }) {
  return <View style={{ height: size }} />;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

export function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <Row justify="space-between" style={{ marginBottom: spacing.sm }}>
      <Text style={styles.sectionHeading}>{title.toUpperCase()}</Text>
      {action}
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Heading({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.heading, style]}>{children}</Text>;
}

export function Body({
  children,
  muted = false,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[styles.body, muted && { color: colors.muted }, style]}
    >
      {children}
    </Text>
  );
}

export function Caption({
  children,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[styles.caption, style]}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  fullWidth = false,
  size = 'md',
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  const palette = buttonPalette[variant];
  const height = size === 'lg' ? 52 : size === 'sm' ? 36 : 46;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={label}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        {
          height,
          backgroundColor: palette.bg,
          borderColor: palette.border,
          paddingHorizontal: size === 'sm' ? spacing.md : spacing.lg,
        },
        fullWidth && { alignSelf: 'stretch' },
        pressed && !isDisabled && { opacity: 0.85 },
        isDisabled && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        <Row gap={spacing.sm}>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 16 : 18} color={palette.fg} /> : null}
          <Text
            style={[
              styles.buttonLabel,
              { color: palette.fg, fontSize: size === 'sm' ? 14 : 15 },
            ]}
          >
            {label}
          </Text>
        </Row>
      )}
    </Pressable>
  );
}

const buttonPalette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.green, fg: colors.white, border: colors.green },
  secondary: { bg: colors.white, fg: colors.ink, border: colors.lineStrong },
  ghost: { bg: 'transparent', fg: colors.navy, border: 'transparent' },
  danger: { bg: colors.redSoft, fg: colors.red, border: colors.redSoft },
};

export function IconButton({
  icon,
  onPress,
  label,
  tint = colors.body,
  size = 20,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  tint?: string;
  size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={size} color={tint} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function TextField({
  label,
  error,
  hint,
  containerStyle,
  ...inputProps
}: TextInputProps & {
  label?: string;
  error?: string | null;
  hint?: string;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[{ gap: spacing.xs }, containerStyle]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        {...inputProps}
        onFocus={(event) => {
          setFocused(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          inputProps.onBlur?.(event);
        }}
        style={[
          styles.input,
          focused && styles.inputFocused,
          error ? styles.inputError : null,
          inputProps.multiline && { height: 96, paddingTop: spacing.md },
          inputProps.style,
        ]}
      />
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hintText}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  active = false,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A cross-platform picker. Native `Picker` and web `<select>` diverge badly,
 * so this is a modal list — identical everywhere and easy to tap with gloves.
 */
export function Select<T extends string>({
  label,
  placeholder = 'Select…',
  value,
  options,
  onChange,
  error,
}: {
  label?: string;
  placeholder?: string;
  value: T | null;
  options: { value: T; label: string; sublabel?: string }[];
  onChange: (value: T) => void;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <View style={{ gap: spacing.xs }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        onPress={() => setOpen(true)}
        style={[styles.input, styles.selectTrigger, error ? styles.inputError : null]}
      >
        <Text style={selected ? styles.selectValue : styles.selectPlaceholder} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(event) => event.stopPropagation()}>
            <Row justify="space-between" style={{ marginBottom: spacing.sm }}>
              <Heading>{label ?? 'Select'}</Heading>
              <IconButton icon="close" label="Close" onPress={() => setOpen(false)} />
            </Row>
            <ScrollView style={{ maxHeight: 380 }}>
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.selectOption,
                      pressed && { backgroundColor: colors.canvas },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.selectOptionLabel}>{option.label}</Text>
                      {option.sublabel ? (
                        <Text style={styles.caption}>{option.sublabel}</Text>
                      ) : null}
                    </View>
                    {active ? (
                      <Ionicons name="checkmark" size={20} color={colors.green} />
                    ) : null}
                  </Pressable>
                );
              })}
              {options.length === 0 ? (
                <Text style={[styles.caption, { padding: spacing.lg }]}>
                  Nothing to choose from yet.
                </Text>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Badge({
  label,
  fg = colors.slate,
  bg = colors.slateSoft,
}: {
  label: string;
  fg?: string;
  bg?: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.green} />
      <Text style={[styles.caption, { marginTop: spacing.sm }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.centered}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.muted} />
      </View>
      <Heading style={{ marginTop: spacing.md, textAlign: 'center' }}>{title}</Heading>
      {message ? (
        <Text style={[styles.body, styles.emptyMessage]}>{message}</Text>
      ) : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  return (
    <View style={styles.centered}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.redSoft }]}>
        <Ionicons name="alert-circle-outline" size={26} color={colors.red} />
      </View>
      <Heading style={{ marginTop: spacing.md, textAlign: 'center' }}>
        That didn&apos;t work
      </Heading>
      <Text style={[styles.body, styles.emptyMessage]}>{message}</Text>
      {onRetry ? (
        <Button label="Try again" variant="secondary" onPress={onRetry} style={{ marginTop: spacing.lg }} />
      ) : null}
    </View>
  );
}

export function InlineError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.inlineError}>
      <Ionicons name="alert-circle" size={16} color={colors.red} />
      <Text style={[styles.smallStrong, { color: colors.red, flex: 1 }]}>{message}</Text>
    </View>
  );
}

export function StatTile({
  label,
  value,
  icon,
  tint = colors.navy,
}: {
  label: string;
  value: string;
  icon: IconName;
  tint?: string;
}) {
  return (
    <View style={styles.statTile}>
      <Row gap={spacing.sm}>
        <Ionicons name={icon} size={16} color={tint} />
        <Text style={styles.statLabel}>{label}</Text>
      </Row>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={{ color: colors.navy, fontWeight: '700', fontSize: size * 0.36 }}>
        {letters || '?'}
      </Text>
    </View>
  );
}

export function ListItem({
  title,
  subtitle,
  icon,
  right,
  onPress,
  destructive = false,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  right?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
}) {
  const content = (
    <Row gap={spacing.md}>
      {icon ? (
        <View style={styles.listIcon}>
          <Ionicons
            name={icon}
            size={18}
            color={destructive ? colors.red : colors.navy}
          />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.bodyStrong, destructive && { color: colors.red }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.caption} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null)}
    </Row>
  );

  if (!onPress) return <View style={styles.listItem}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.listItem, pressed && { backgroundColor: colors.canvas }]}
    >
      {content}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  scrollContent: { paddingBottom: spacing.xxl * 2, flexGrow: 1 },
  contentColumn: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    flexGrow: 1,
  },
  contentPadded: { padding: spacing.lg, gap: spacing.lg },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow,
  },

  divider: { height: 1, backgroundColor: colors.line },

  sectionHeading: {
    ...typography.micro,
    color: colors.muted,
  },

  title: { ...typography.title, color: colors.ink },
  heading: { ...typography.heading, color: colors.ink },
  body: { ...typography.body, color: colors.body },
  bodyStrong: { ...typography.bodyStrong, color: colors.ink },
  caption: { ...typography.small, color: colors.muted },
  smallStrong: { ...typography.smallStrong },

  button: {
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  buttonLabel: { fontWeight: '600' },

  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },

  fieldLabel: { ...typography.smallStrong, color: colors.ink },
  input: {
    height: 46,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 15,
  },
  inputFocused: { borderColor: colors.green },
  inputError: { borderColor: colors.red },
  errorText: { ...typography.small, color: colors.red },
  hintText: { ...typography.small, color: colors.muted },

  selectTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  selectValue: { fontSize: 15, color: colors.ink, flex: 1 },
  selectPlaceholder: { fontSize: 15, color: colors.muted, flex: 1 },
  selectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  selectOptionLabel: { ...typography.body, color: colors.ink },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(16,24,40,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.slateSoft,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm - 1,
    alignItems: 'center',
  },
  segmentActive: { backgroundColor: colors.surface, ...shadow },
  segmentLabel: { ...typography.smallStrong, color: colors.body },
  segmentLabelActive: { color: colors.ink },

  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipLabel: { ...typography.smallStrong, color: colors.body },
  chipLabelActive: { color: colors.white },

  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeLabel: { ...typography.micro },

  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    flexGrow: 1,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.slateSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMessage: {
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: 320,
  },

  inlineError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.redSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },

  statTile: {
    flex: 1,
    minWidth: 140,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statLabel: { ...typography.small, color: colors.body },
  statValue: { ...typography.display, fontSize: 24, color: colors.ink },

  avatar: {
    backgroundColor: colors.waveSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  listItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  listIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
