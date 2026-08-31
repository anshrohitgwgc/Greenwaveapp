import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

/**
 * Re-encodes an uploaded image server-side and drops all embedded metadata
 * (EXIF/GPS/IPTC/XMP/ICC-profile-carried camera & location data included).
 *
 * sharp only writes metadata into its output when `.withMetadata()` is
 * called — by default the output buffer carries none, so a plain decode+
 * re-encode is sufficient to strip GPS/camera data. `.rotate()` (no args)
 * applies the EXIF orientation as a pixel transform *before* that metadata
 * is discarded, so a photo taken in portrait doesn't come out sideways.
 *
 * Also serves as content-sniffing: a file whose declared mimetype lies
 * about being an image (e.g. a renamed .txt) will fail to decode here and
 * is rejected, rather than being stored and served back as "an image".
 */
export async function sanitizeImage(
  buffer: Buffer,
  mimeType: string,
): Promise<Buffer> {
  let pipeline: sharp.Sharp;
  try {
    pipeline = sharp(buffer, { failOn: 'error' }).rotate();
    // Force a metadata read now so a malformed/non-image buffer throws
    // here with a clear error, rather than lazily during toBuffer().
    await pipeline.metadata();
  } catch {
    throw new BadRequestException('Uploaded file is not a valid image');
  }

  switch (mimeType) {
    case 'image/png':
      return pipeline.png().toBuffer();
    case 'image/webp':
      return pipeline.webp({ quality: 90 }).toBuffer();
    case 'image/jpeg':
    default:
      return pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  }
}
