declare module 'piexifjs' {
  interface GpsIfdTags {
    GPSLatitudeRef: number;
    GPSLatitude: number;
    GPSLongitudeRef: number;
    GPSLongitude: number;
    GPSAltitudeRef: number;
    GPSAltitude: number;
    GPSTimeStamp: number;
    GPSDateStamp: number;
  }

  interface ImageIfdTags {
    Make: number;
    Model: number;
  }

  interface ExifObject {
    '0th'?: Record<number, unknown>;
    Exif?: Record<number, unknown>;
    GPS?: Record<number, unknown>;
  }

  const piexif: {
    GPSIFD: GpsIfdTags;
    ImageIFD: ImageIfdTags;
    GPSHelper: {
      degToDmsRational(degFloat: number): [number, number][];
    };
    dump(exifObj: ExifObject): string;
    insert(exifBytes: string, jpegBinaryString: string): string;
  };

  export = piexif;
}
