import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { MAX_INVENTORY_PHOTOS } from '../common/photo-limits';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

/**
 * Coverage for the inventory photo limit at the API boundary.
 *
 * The behaviour these lock down is the one that was broken: an entry could
 * only ever carry one photo, and extra selections were dropped without the
 * operator being told. The cases below are the boundaries named in the
 * requirement -- 0, 1, 2, 15 and an attempted 16.
 */
describe('PhotosController — batch upload', () => {
  let controller: PhotosController;
  let photosService: { uploadMany: jest.Mock; upload: jest.Mock };

  const actor: AuthenticatedUser = {
    id: 7,
    role: 'staff',
    email: 'yard@example.com',
    fullName: 'Yard Operator',
  };

  const file = (name: string, mimetype = 'image/jpeg') =>
    ({
      originalname: name,
      mimetype,
      size: 2048,
      buffer: Buffer.from('fake-image-bytes'),
    }) as Express.Multer.File;

  const files = (n: number) =>
    Array.from({ length: n }, (_, i) => file(`load-${i + 1}.jpg`));

  beforeEach(async () => {
    photosService = {
      uploadMany: jest.fn((f: Express.Multer.File[]) =>
        Promise.resolve(
          f.map((x, i) => ({
            id: `photo-${i + 1}`,
            originalFilename: x.originalname,
          })),
        ),
      ),
      upload: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PhotosController],
      providers: [{ provide: PhotosService, useValue: photosService }],
    }).compile();

    controller = module.get<PhotosController>(PhotosController);
  });

  it('exposes a limit of 15', () => {
    expect(MAX_INVENTORY_PHOTOS).toBe(15);
  });

  it('rejects 0 photos with a clear message', () => {
    expect(() => controller.uploadMany([], {}, actor)).toThrow(
      BadRequestException,
    );
    expect(photosService.uploadMany).not.toHaveBeenCalled();
  });

  it('accepts 1 photo', async () => {
    const result = await controller.uploadMany(files(1), {}, actor);
    expect(result).toHaveLength(1);
    expect(photosService.uploadMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ originalname: 'load-1.jpg' }),
      ]),
      {},
      actor,
    );
  });

  it('accepts 2 photos and keeps both', async () => {
    const result = await controller.uploadMany(files(2), {}, actor);
    expect(result).toHaveLength(2);
    const calls = photosService.uploadMany.mock.calls as Array<
      [Express.Multer.File[]]
    >;
    const sent = calls[0][0];
    expect(sent.map((f) => f.originalname)).toEqual([
      'load-1.jpg',
      'load-2.jpg',
    ]);
  });

  it('accepts exactly 15 photos', async () => {
    const result = await controller.uploadMany(
      files(MAX_INVENTORY_PHOTOS),
      {},
      actor,
    );
    expect(result).toHaveLength(MAX_INVENTORY_PHOTOS);
  });

  it('rejects 16 photos by naming the limit rather than silently dropping one', () => {
    expect(() =>
      controller.uploadMany(files(MAX_INVENTORY_PHOTOS + 1), {}, actor),
    ).toThrow(
      `A maximum of ${MAX_INVENTORY_PHOTOS} photos can be uploaded at once`,
    );
    // Nothing is stored — a partial set is worse than a clean error.
    expect(photosService.uploadMany).not.toHaveBeenCalled();
  });

  it('rejects the whole batch when one file is not an accepted image', () => {
    const mixed = [file('good.jpg'), file('payload.txt', 'text/plain')];
    expect(() => controller.uploadMany(mixed, {}, actor)).toThrow(
      /Only JPEG, PNG or WebP/,
    );
    expect(photosService.uploadMany).not.toHaveBeenCalled();
  });

  it('passes upload metadata through so photos stay linked to the job', async () => {
    const meta = {
      warehouseId: '3f1f0b1a-0000-4000-8000-000000000001',
      photoType: 'inventory_inbound',
      jobReference: 'Jul20-DIVESTPC-AB38A',
    };
    await controller.uploadMany(files(3), meta, actor);
    expect(photosService.uploadMany).toHaveBeenCalledWith(
      expect.any(Array),
      meta,
      actor,
    );
  });
});
