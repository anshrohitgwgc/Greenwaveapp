import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'stream';

import { StorageService } from './storage.service';

describe('StorageService', () => {
  let service: StorageService;
  let mockMinioClient: {
    getObject: jest.Mock;
    statObject: jest.Mock;
    presignedGetObject: jest.Mock;
  };

  beforeEach(async () => {
    mockMinioClient = {
      getObject: jest.fn(),
      statObject: jest.fn(),
      presignedGetObject: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'MINIO_BUCKET') return 'greenwave-photos';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
    // Inject mock client directly onto private property
    (service as unknown as { client: typeof mockMinioClient }).client =
      mockMinioClient;
    (service as unknown as { bucket: string }).bucket = 'greenwave-photos';
  });

  describe('validateObjectKey (Path traversal & boundary escape prevention)', () => {
    it('accepts safe, valid object keys', () => {
      expect(() =>
        service.validateObjectKey('photos/wh1/abc-123.jpg'),
      ).not.toThrow();
      expect(() => service.validateObjectKey('uploads/test.png')).not.toThrow();
      expect(() => service.validateObjectKey('item_42-v1.webp')).not.toThrow();
    });

    it('rejects keys containing double dots (..)', () => {
      expect(() => service.validateObjectKey('../etc/passwd')).toThrow(
        'Invalid storage object key',
      );
      expect(() =>
        service.validateObjectKey('photos/../../secret.txt'),
      ).toThrow('Invalid storage object key');
      expect(() => service.validateObjectKey('a/b/../c')).toThrow(
        'Invalid storage object key',
      );
    });

    it('rejects keys starting with leading slash or backslash', () => {
      expect(() => service.validateObjectKey('/etc/shadow')).toThrow(
        'Invalid storage object key',
      );
      expect(() => service.validateObjectKey('\\windows\\system32')).toThrow(
        'Invalid storage object key',
      );
    });

    it('rejects keys containing backslashes', () => {
      expect(() => service.validateObjectKey('photos\\escape.jpg')).toThrow(
        'Invalid storage object key',
      );
    });

    it('rejects empty, null, or non-string keys', () => {
      expect(() => service.validateObjectKey('')).toThrow(
        'Storage object key is required',
      );
      expect(() =>
        service.validateObjectKey(null as unknown as string),
      ).toThrow('Storage object key is required');
    });
  });

  describe('getObject', () => {
    it('returns readable stream for an existing object', async () => {
      const mockStream = new Readable({
        read() {
          this.push(null);
        },
      });
      mockMinioClient.getObject.mockResolvedValue(mockStream);

      const stream = await service.getObject('photos/wh1/test.jpg');
      expect(stream).toBe(mockStream);
      expect(mockMinioClient.getObject).toHaveBeenCalledWith(
        'greenwave-photos',
        'photos/wh1/test.jpg',
      );
    });

    it('throws NotFoundException when object is missing or MinIO errors with NotFound', async () => {
      const err = new Error('The specified key does not exist.');
      (err as unknown as { code: string }).code = 'NoSuchKey';
      mockMinioClient.getObject.mockRejectedValue(err);

      await expect(service.getObject('photos/missing.jpg')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('statObject & objectExists', () => {
    it('returns stat info when object exists', async () => {
      const mockStat = {
        size: 1024,
        metaData: { 'content-type': 'image/jpeg' },
      };
      mockMinioClient.statObject.mockResolvedValue(mockStat);

      const stat = await service.statObject('photos/wh1/test.jpg');
      expect(stat).toBe(mockStat);
      expect(mockMinioClient.statObject).toHaveBeenCalledWith(
        'greenwave-photos',
        'photos/wh1/test.jpg',
      );
    });

    it('objectExists returns true when stat succeeds', async () => {
      mockMinioClient.statObject.mockResolvedValue({ size: 100 });
      const exists = await service.objectExists('photos/wh1/test.jpg');
      expect(exists).toBe(true);
    });

    it('objectExists returns false when stat throws', async () => {
      mockMinioClient.statObject.mockRejectedValue(new Error('NotFound'));
      const exists = await service.objectExists('photos/missing.jpg');
      expect(exists).toBe(false);
    });
  });
});
