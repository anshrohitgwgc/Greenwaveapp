import piexif from 'piexifjs';
import sharp from 'sharp';

/**
 * Builds a real, valid JPEG (solid-color test pattern) with embedded EXIF
 * GPS coordinates + camera/device metadata, for asserting that the server
 * strips it on upload. Coordinates are Calgary, AB (51.0447 N, 114.0719 W)
 * — arbitrary but realistic values, not tied to any real device.
 */
export async function createJpegWithGpsExif(): Promise<Buffer> {
  const plainJpeg = await sharp({
    create: {
      width: 240,
      height: 180,
      channels: 3,
      background: { r: 80, g: 140, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();

  const gps: Record<number, unknown> = {};
  gps[piexif.GPSIFD.GPSLatitudeRef] = 'N';
  gps[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(51.0447);
  gps[piexif.GPSIFD.GPSLongitudeRef] = 'W';
  gps[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(114.0719);
  gps[piexif.GPSIFD.GPSAltitudeRef] = 0;
  gps[piexif.GPSIFD.GPSAltitude] = [1045, 1];
  gps[piexif.GPSIFD.GPSTimeStamp] = [
    [12, 1],
    [0, 1],
    [0, 1],
  ];
  gps[piexif.GPSIFD.GPSDateStamp] = '2026:08:31';

  const zeroth: Record<number, unknown> = {};
  zeroth[piexif.ImageIFD.Make] = 'GreenWaveTestCam';
  zeroth[piexif.ImageIFD.Model] = 'EXIF-Security-Test-Rig';

  const exifBytes = piexif.dump({ '0th': zeroth, Exif: {}, GPS: gps });
  const withExif = piexif.insert(exifBytes, plainJpeg.toString('binary'));

  return Buffer.from(withExif, 'binary');
}
