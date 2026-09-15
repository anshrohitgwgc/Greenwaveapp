import { Readable } from 'stream';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { StorageService } from '../storage/storage.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { PhotoAsset } from './entities/photo-asset.entity';
import { PhotosService } from './photos.service';

function makeQueryBuilder(result: PhotoAsset[]) {
  const qb: Record<string, jest.Mock> = {
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue(result),
  };
  qb.andWhere.mockReturnValue(qb);
  qb.orderBy.mockReturnValue(qb);
  return qb;
}

describe('PhotosService', () => {
  let service: PhotosService;
  let photoRepo: { createQueryBuilder: jest.Mock; findOne: jest.Mock };
  let storageService: { presignedGetUrl: jest.Mock };
  let warehousesService: {
    assertWarehouseAccess: jest.Mock;
    getUserAuthorizedWarehouseIds: jest.Mock;
  };

  const staffPhoto = { id: 'p1', takenBy: 1, objectKey: 'k1' } as PhotoAsset;
  const otherStaffPhoto = {
    id: 'p2',
    takenBy: 2,
    objectKey: 'k2',
  } as PhotoAsset;

  const staffActor: AuthenticatedUser = {
    id: 1,
    role: 'staff',
    email: 'staff@example.com',
    fullName: 'Staff',
  };
  const managerActor: AuthenticatedUser = {
    id: 9,
    role: 'manager',
    email: 'manager@example.com',
    fullName: 'Manager',
    hasGlobalAccess: true,
  };

  beforeEach(async () => {
    photoRepo = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
    };
    storageService = {
      presignedGetUrl: jest
        .fn()
        .mockResolvedValue('https://minio.local/signed'),
    };
    warehousesService = {
      assertWarehouseAccess: jest.fn().mockResolvedValue(undefined),
      getUserAuthorizedWarehouseIds: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhotosService,
        { provide: getRepositoryToken(PhotoAsset), useValue: photoRepo },
        { provide: StorageService, useValue: storageService },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: WarehousesService, useValue: warehousesService },
      ],
    }).compile();

    service = module.get(PhotosService);
  });

  describe('list — IDOR guard', () => {
    it('forces staff to only see their own photos, ignoring a requested userId', async () => {
      const qb = makeQueryBuilder([staffPhoto]);
      photoRepo.createQueryBuilder.mockReturnValue(qb);

      await service.list(staffActor, { userId: 2 });

      expect(qb.andWhere).toHaveBeenCalledWith('photo.takenBy = :ownerId', {
        ownerId: 1,
      });
      expect(qb.andWhere).not.toHaveBeenCalledWith('photo.takenBy = :ownerId', {
        ownerId: 2,
      });
    });

    it('lets a manager filter by any userId', async () => {
      const qb = makeQueryBuilder([otherStaffPhoto]);
      photoRepo.createQueryBuilder.mockReturnValue(qb);

      await service.list(managerActor, { userId: 2 });

      expect(qb.andWhere).toHaveBeenCalledWith('photo.takenBy = :ownerId', {
        ownerId: 2,
      });
    });
  });

  describe('findOneAuthorized', () => {
    it('lets a staff member view their own photo', async () => {
      photoRepo.findOne.mockResolvedValue(staffPhoto);
      await expect(
        service.findOneAuthorized('p1', staffActor),
      ).resolves.toBeDefined();
    });

    it("blocks a staff member from viewing another staff member's photo by id", async () => {
      photoRepo.findOne.mockResolvedValue(otherStaffPhoto);
      await expect(service.findOneAuthorized('p2', staffActor)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException for nonexistent photo', async () => {
      photoRepo.findOne.mockResolvedValue(null);
      await expect(
        service.findOneAuthorized('missing', staffActor),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPhotoStream', () => {
    it('returns stream and stat for an authorized photo', async () => {
      const mockStream = Readable.from([]);
      photoRepo.findOne.mockResolvedValue({
        id: 'p1',
        takenBy: 1,
        warehouseId: 'w1',
        objectKey: 'photos/w1/p1.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
      });
      (storageService as unknown as { getObject: jest.Mock }).getObject = jest
        .fn()
        .mockResolvedValue(mockStream);

      const result = await service.getPhotoStream('p1', staffActor);
      expect(result.stream).toBe(mockStream);
      expect(result.photo.id).toBe('p1');
    });

    it('rejects cross-warehouse access with ForbiddenException', async () => {
      warehousesService.assertWarehouseAccess.mockRejectedValue(
        new ForbiddenException('Cross-warehouse denied'),
      );
      photoRepo.findOne.mockResolvedValue({
        id: 'p1',
        takenBy: 1,
        warehouseId: 'w2',
        objectKey: 'photos/w2/p1.png',
      });

      await expect(service.getPhotoStream('p1', staffActor)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('toDto', () => {
    it('returns relative API endpoints instead of internal MinIO URLs', () => {
      const dto = service.toDto({
        id: 'photo-100',
        objectKey: 'photos/w1/p100.jpg',
        originalFilename: 'receipt.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 5000,
        takenBy: 1,
        takenAt: new Date(),
        warehouseId: 'w1',
      } as PhotoAsset);

      expect(dto.url).toBe('/api/photos/photo-100/view');
      expect(dto.thumbnailUrl).toBe('/api/photos/photo-100/thumbnail');
      expect(dto.downloadUrl).toBe('/api/photos/photo-100/download');
      expect(dto.url).not.toContain('localhost:9000');
      expect(dto.url).not.toContain('minio');
    });
  });
});
