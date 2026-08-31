import { BadRequestException } from '@nestjs/common';
import exifr from 'exifr';
import sharp from 'sharp';

import { createJpegWithGpsExif } from '../../test/fixtures/exif-jpeg';
import { sanitizeImage } from './image-sanitizer';

interface ParsedExif {
  latitude?: number;
  longitude?: number;
  GPSAltitude?: number;
  GPSTimeStamp?: unknown;
  Make?: string;
  Model?: string;
}

describe('sanitizeImage', () => {
  it('strips GPS and camera EXIF metadata while keeping the image readable', async () => {
    const original = await createJpegWithGpsExif();

    const beforeExif = (await exifr.parse(original, {
      gps: true,
      exif: true,
    })) as ParsedExif;
    expect(beforeExif.latitude).toBeCloseTo(51.0447, 3);
    expect(beforeExif.Make).toBe('GreenWaveTestCam');

    const sanitized = await sanitizeImage(original, 'image/jpeg');
    const afterExif = (await exifr.parse(sanitized, {
      gps: true,
      exif: true,
    })) as ParsedExif | undefined;

    expect(afterExif?.latitude).toBeUndefined();
    expect(afterExif?.longitude).toBeUndefined();
    expect(afterExif?.GPSAltitude).toBeUndefined();
    expect(afterExif?.GPSTimeStamp).toBeUndefined();
    expect(afterExif?.Make).toBeUndefined();
    expect(afterExif?.Model).toBeUndefined();

    const meta = await sharp(sanitized).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(240);
    expect(meta.height).toBe(180);
  });

  it('rejects a buffer that is not actually a decodable image', async () => {
    const notAnImage = Buffer.from('not an image at all', 'utf8');
    await expect(sanitizeImage(notAnImage, 'image/jpeg')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('preserves visual orientation by baking in EXIF rotation before stripping it', async () => {
    // A 3:2 image explicitly marked "rotate 90° CW to display" (Orientation 6).
    const rotated = await sharp({
      create: { width: 300, height: 200, channels: 3, background: 'red' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const sanitized = await sanitizeImage(rotated, 'image/jpeg');
    const meta = await sharp(sanitized).metadata();

    // Orientation tag is gone (stripped)...
    expect(meta.orientation).toBeUndefined();
    // ...but the pixel dimensions reflect the tag having been applied
    // first, so the image doesn't silently end up sideways.
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(300);
  });
});
