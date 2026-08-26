/**
 * Multipart photo upload.
 *
 * Uses XMLHttpRequest rather than fetch on purpose:
 *  - React Native's XHR understands FormData entries shaped as
 *    `{ uri, name, type }`, which is how expo-image-picker hands back a file
 *    on iOS/Android.
 *  - Browsers get a real `File`/`Blob`.
 *  - XHR gives upload progress, which fetch does not.
 */

import { Platform } from 'react-native';
import { config } from './config';
import { ApiError, currentAccessToken } from './client';

export interface PickedImage {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  /** Present on web from expo-image-picker. */
  file?: File | Blob | null;
}

function guessMime(uri: string, provided?: string | null): string {
  if (provided) return provided;
  const extension = uri.split('?')[0]?.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function guessName(image: PickedImage, mime: string): string {
  if (image.fileName) return image.fileName;
  const extension = mime.split('/')[1] ?? 'jpg';
  return `photo-${Date.now()}.${extension}`;
}

export interface UploadOptions {
  /** Field name the API expects. Defaults to "file". */
  fieldName?: string;
  caption?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export function uploadImage<T>(
  path: string,
  image: PickedImage,
  options: UploadOptions = {},
): Promise<T> {
  const { fieldName = 'file', caption, onProgress, signal } = options;

  return new Promise<T>((resolve, reject) => {
    const mime = guessMime(image.uri, image.mimeType);
    const name = guessName(image, mime);

    const form = new FormData();

    if (Platform.OS === 'web') {
      const blob = image.file;
      if (!blob) {
        reject(new ApiError(0, 'Could not read the selected image.'));
        return;
      }
      form.append(fieldName, blob, name);
    } else {
      // React Native's FormData accepts this shape; the cast is required
      // because the DOM typings do not describe it.
      form.append(fieldName, {
        uri: image.uri,
        name,
        type: mime,
      } as unknown as Blob);
    }

    if (caption) form.append('caption', caption);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${config.apiBaseUrl}${path}`);
    xhr.timeout = Math.max(config.timeoutMs, 60_000);

    const token = currentAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    // Content-Type is intentionally NOT set — the runtime adds the
    // multipart boundary itself.

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(event.loaded / event.total);
        }
      };
    }

    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        parsed = xhr.responseText;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as T);
        return;
      }

      const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      const message =
        (typeof record.message === 'string' && record.message) ||
        (typeof record.error === 'string' && record.error) ||
        (xhr.status === 413
          ? 'That photo is too large. Try a smaller image.'
          : `Upload failed (${xhr.status}).`);

      reject(new ApiError(xhr.status, message, parsed));
    };

    xhr.onerror = () => reject(new ApiError(0, 'Upload failed. Check your connection.'));
    xhr.ontimeout = () => reject(new ApiError(0, 'The upload timed out.'));
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled.'));

    if (signal) {
      if (signal.aborted) xhr.abort();
      else signal.addEventListener('abort', () => xhr.abort());
    }

    xhr.send(form);
  });
}
