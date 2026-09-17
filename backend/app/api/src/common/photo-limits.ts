/**
 * Single source of truth for inventory photo limits.
 *
 * Before this existed the "one photo" ceiling was spread across unrelated
 * magic numbers and single-value assumptions (a bare `FileInterceptor`, a
 * scalar `photoId`, `input.files[0]`). Every layer that enforces a count now
 * imports from here so the limit can only ever change in one place.
 *
 * The frontend mirrors these in assets/photos.js (`Photos.MAX_PHOTOS`); the
 * two must stay in step, but the backend is the authoritative check — the
 * browser value is a UX affordance, not a control.
 */

/** Maximum photos that may be attached to a single inventory entry. */
export const MAX_INVENTORY_PHOTOS = 15;

/** Maximum accepted size of any one uploaded image, in bytes. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Image content types the API will store. */
export const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
