/**
 * Cross-platform dialogs.
 *
 * react-native-web's Alert is a no-op, so web falls back to the browser's
 * native confirm/alert. Same call site everywhere.
 */

import { Alert, Platform } from 'react-native';

export function confirm(options: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const {
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
  } = options;

  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    return Promise.resolve(globalThis.confirm?.(text) ?? false);
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}

export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    globalThis.alert?.(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

/** A small action sheet built from Alert on native; a confirm on web. */
export function chooseSource(): Promise<'camera' | 'library' | null> {
  if (Platform.OS === 'web') {
    // Browsers open a file dialog either way; skip the extra step.
    return Promise.resolve('library');
  }

  return new Promise((resolve) => {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take photo', onPress: () => resolve('camera') },
      { text: 'Choose from library', onPress: () => resolve('library') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}
