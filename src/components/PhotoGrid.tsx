import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Button, Caption, IconButton, InlineError, Row } from './ui';
import { colors, radius, spacing, typography } from '@/theme';
import { config } from '@/api/config';
import { useAddJobPhoto, useDeleteJobPhoto } from '@/api/queries';
import { isLocalId } from '@/offline/optimistic';
import { chooseSource, confirm, notify } from '@/utils/dialogs';
import type { JobPhoto } from '@/api/types';
import type { PickedImage } from '@/api/service';

const TILE = 96;

export function PhotoGrid({
  jobId,
  photos,
  editable = true,
}: {
  jobId: string;
  photos: JobPhoto[];
  editable?: boolean;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<JobPhoto | null>(null);

  const addPhoto = useAddJobPhoto(jobId);
  const deletePhoto = useDeleteJobPhoto(jobId);

  const atLimit = photos.length >= config.maxPhotosPerJob;

  async function pick() {
    setError(null);

    if (atLimit) {
      notify(
        'Photo limit reached',
        `This job already has ${config.maxPhotosPerJob} photos. Remove one to add another.`,
      );
      return;
    }

    const source = await chooseSource();
    if (!source) return;

    try {
      let result: ImagePicker.ImagePickerResult;

      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('Camera access is off. Enable it in your device settings to take photos.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          quality: 0.7,
          allowsEditing: false,
          exif: false,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setError('Photo access is off. Enable it in your device settings to attach photos.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.7,
          allowsMultipleSelection: true,
          selectionLimit: Math.max(1, config.maxPhotosPerJob - photos.length),
          exif: false,
        });
      }

      if (result.canceled) return;

      for (const asset of result.assets) {
        const image: PickedImage = {
          uri: asset.uri,
          fileName: asset.fileName ?? null,
          mimeType: asset.mimeType ?? null,
          file: (asset as { file?: File }).file ?? null,
        };

        setProgress(0);
        await addPhoto.mutateAsync({ image, onProgress: setProgress });
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : 'That photo could not be uploaded.',
      );
    } finally {
      setProgress(null);
    }
  }

  async function remove(photo: JobPhoto) {
    const ok = await confirm({
      title: 'Remove this photo?',
      message: 'It will be deleted from the job permanently.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    setPreview(null);
    try {
      await deletePhoto.mutateAsync(photo.id);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : 'Could not remove that photo.',
      );
    }
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Row justify="space-between">
        <Caption>
          {photos.length} of {config.maxPhotosPerJob} photos
        </Caption>
        {editable ? (
          <Button
            label={progress !== null ? `Uploading ${Math.round(progress * 100)}%` : 'Add photo'}
            icon="camera-outline"
            variant="secondary"
            size="sm"
            loading={progress !== null && progress < 1}
            disabled={atLimit}
            onPress={pick}
          />
        ) : null}
      </Row>

      <InlineError message={error} />

      {photos.length === 0 ? (
        <View style={styles.placeholder}>
          <Ionicons name="images-outline" size={22} color={colors.muted} />
          <Text style={styles.placeholderText}>
            {editable ? 'No photos yet — add one from the camera or your library.' : 'No photos.'}
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {photos.map((photo) => (
            <Pressable
              key={photo.id}
              accessibilityRole="imagebutton"
              accessibilityLabel={
                isLocalId(photo.id)
                  ? 'Job photo, waiting to upload'
                  : (photo.caption ?? 'Job photo')
              }
              onPress={() => setPreview(photo)}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
            >
              <Image
                source={{ uri: photo.thumbnailUrl ?? photo.url }}
                style={styles.tileImage}
                contentFit="cover"
                transition={150}
              />
              {isLocalId(photo.id) ? (
                <View style={styles.pendingBadge}>
                  <Ionicons name="cloud-upload" size={11} color={colors.white} />
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}

      <Modal visible={preview !== null} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={styles.previewBackdrop}>
          <Row justify="space-between" style={styles.previewBar}>
            <Text style={styles.previewCaption} numberOfLines={1}>
              {preview?.caption ?? 'Job photo'}
            </Text>
            <Row gap={spacing.sm}>
              {editable && preview ? (
                <IconButton
                  icon="trash-outline"
                  label="Remove photo"
                  tint={colors.white}
                  onPress={() => remove(preview)}
                />
              ) : null}
              <IconButton
                icon="close"
                label="Close preview"
                tint={colors.white}
                onPress={() => setPreview(null)}
              />
            </Row>
          </Row>
          <Pressable style={styles.previewBody} onPress={() => setPreview(null)}>
            {preview ? (
              <Image
                source={{ uri: preview.url }}
                style={styles.previewImage}
                contentFit="contain"
              />
            ) : null}
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.slateSoft,
  },
  tileImage: { width: '100%', height: '100%' },
  pendingBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.lineStrong,
    backgroundColor: colors.canvas,
  },
  placeholderText: {
    ...typography.small,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(7,41,62,0.96)' },
  previewBar: { padding: spacing.lg, paddingTop: spacing.xxl },
  previewCaption: { ...typography.bodyStrong, color: colors.white, flex: 1 },
  previewBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: '100%' },
});
