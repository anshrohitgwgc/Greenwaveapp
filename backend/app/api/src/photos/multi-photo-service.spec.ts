import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { MAX_INVENTORY_PHOTOS } from '../common/photo-limits';
import { StorageService } from '../storage/storage.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { PhotoAsset } from './entities/photo-asset.entity';
import { PhotosService } from './photos.service';

jest.mock('./image-sanitizer', () => ({
  sanitizeImage: jest.fn((buffer: Buffer) => Promise.resolve(buffer)),
}));

describe('PhotosService.uploadMany', () => {
  let service: PhotosService;
  let storageService: {
    upload: jest.Mock;
    delete: jest.Mock;
    getObject: jest.Mock;
    getBucketName: jest.Mock;
  };
  let photoRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };

  const actor: AuthenticatedUser = {
    id: 4,
    role: 'staff',
    email: 'yard@example.com',
    fullName: 'Yard Operator',
  };

  const file = (name: string) => ({
    originalname: name,
    mimetype: 'image/jpeg',
    size: 1024,
    buffer: Buffer.from('bytes'),
  });

  const files = (n: number) =>
    Array.from({ length: n }, (_, i) => file(`p-${i + 1}.jpg`));

  beforeEach(async () => {
    storageService = {
      upload: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      getObject: jest.fn(),
      getBucketName: jest.fn().mockReturnValue('greenwave-photos'),
    };
    photoRepo = {
      create: jest.fn((v: Partial<PhotoAsset>) => v),
      save: jest.fn((v: Partial<PhotoAsset>) => Promise.resolve(v)),
      findOne: jest.fn((opts: { where: { id: string } }) =>
        Promise.resolve({
          id: opts.where.id,
          takenBy: actor.id,
          objectKey: `photos/general/${opts.where.id}`,
          warehouseId: null,
        }),
      ),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhotosService,
        { provide: getRepositoryToken(PhotoAsset), useValue: photoRepo },
        { provide: StorageService, useValue: storageService },
        { provide: AuditService, useValue: { record: jest.fn() } },
        {
          provide: WarehousesService,
          useValue: {
            assertWarehouseAccess: jest.fn().mockResolvedValue(undefined),
            getUserAuthorizedWarehouseIds: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<PhotosService>(PhotosService);
  });

  it('stores every file in a batch of 15 — none are dropped', async () => {
    const result = await service.uploadMany(files(15), {}, actor);

    expect(result).toHaveLength(MAX_INVENTORY_PHOTOS);
    expect(storageService.upload).toHaveBeenCalledTimes(MAX_INVENTORY_PHOTOS);
    // Each object key is distinct, so photo N never overwrites photo N-1.
    const uploadCalls = storageService.upload.mock.calls as Array<[string]>;
    const keys = uploadCalls.map((c) => c[0]);
    expect(new Set(keys).size).toBe(MAX_INVENTORY_PHOTOS);
  });

  it('keeps caller order so the first selected photo becomes the cover', async () => {
    const result = await service.uploadMany(files(3), {}, actor);
    expect(result.map((p) => p.originalFilename)).toEqual([
      'p-1.jpg',
      'p-2.jpg',
      'p-3.jpg',
    ]);
  });

  it('refuses more than the limit', async () => {
    await expect(service.uploadMany(files(16), {}, actor)).rejects.toThrow(
      /maximum of 15 photos/,
    );
    expect(storageService.upload).not.toHaveBeenCalled();
  });

  it('rolls back already-stored photos when one file fails mid-batch', async () => {
    storageService.upload
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('MinIO connection reset'));

    await expect(service.uploadMany(files(4), {}, actor)).rejects.toThrow(
      'MinIO connection reset',
    );

    // The two that made it are removed rather than left as a partial set.
    expect(storageService.delete).toHaveBeenCalledTimes(2);
    expect(photoRepo.delete).toHaveBeenCalledTimes(2);
  });

  it('tags every photo in a batch with the shared job reference', async () => {
    await service.uploadMany(
      files(3),
      { jobReference: 'Jul20-DIVESTPC-AB38A', photoType: 'inventory_inbound' },
      actor,
    );
    const saveCalls = photoRepo.save.mock.calls as Array<[Partial<PhotoAsset>]>;
    const saved = saveCalls.map((c) => c[0]);
    expect(saved).toHaveLength(3);
    saved.forEach((p) => {
      expect(p.jobReference).toBe('Jul20-DIVESTPC-AB38A');
      expect(p.photoType).toBe('inventory_inbound');
    });
  });

  it('uploads 0 files without touching storage', async () => {
    const result = await service.uploadMany([], {}, actor);
    expect(result).toEqual([]);
    expect(storageService.upload).not.toHaveBeenCalled();
  });
});
