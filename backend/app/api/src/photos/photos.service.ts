import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { MAX_INVENTORY_PHOTOS } from '../common/photo-limits';
import { StorageService } from '../storage/storage.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { UploadPhotoMetadataDto } from './dto/upload-photo-metadata.dto';
import { PhotoAsset } from './entities/photo-asset.entity';
import { sanitizeImage } from './image-sanitizer';

const PRIVILEGED_ROLES = ['admin', 'manager'];

@Injectable()
export class PhotosService {
  constructor(
    @InjectRepository(PhotoAsset)
    private readonly photoRepository: Repository<PhotoAsset>,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly warehousesService: WarehousesService,
  ) {}

  async upload(
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
    meta: UploadPhotoMetadataDto,
    actor: AuthenticatedUser,
  ) {
    if (meta.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        meta.warehouseId,
      );
    }

    // Strip EXIF/GPS/camera metadata server-side before the bytes ever
    // reach storage. Must happen here, not in the browser — a client can
    // always send raw bytes directly to this API, bypassing any frontend
    // sanitization.
    const sanitizedBuffer = await sanitizeImage(file.buffer, file.mimetype);

    const id = randomUUID();
    const scope = meta.warehouseId ?? 'general';
    const objectKey = `photos/${scope}/${id}-${file.originalname}`;

    await this.storageService.upload(objectKey, sanitizedBuffer, file.mimetype);

    const photo = this.photoRepository.create({
      id,
      objectKey,
      bucketName: this.storageService.getBucketName(),
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: sanitizedBuffer.length,
      warehouseId: meta.warehouseId ?? null,
      customerId: meta.customerId ?? null,
      jobReference: meta.jobReference ?? null,
      photoType: meta.photoType ?? null,
      takenBy: actor.id,
      takenAt: new Date(),
    });

    const saved = await this.photoRepository.save(photo);

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'photo.uploaded',
      entityType: 'photo',
      entityId: saved.id,
      warehouseId: saved.warehouseId,
      summary: `${actor.email} uploaded a photo${meta.photoType ? ` (${meta.photoType})` : ''}`,
    });

    return this.toDto(saved);
  }

  /**
   * Upload a set of images as one logical batch (inventory photo picker).
   *
   * Uploads run sequentially rather than via Promise.all: a phone on warehouse
   * wifi pushing 15 images concurrently is how you get MinIO socket timeouts
   * and a half-written set. If any image fails, the ones already stored are
   * removed again so the caller never ends up with a silently partial set —
   * the inventory flow treats photos as all-or-nothing.
   */
  async uploadMany(
    files: Array<{
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    }>,
    meta: UploadPhotoMetadataDto,
    actor: AuthenticatedUser,
  ) {
    if (files.length > MAX_INVENTORY_PHOTOS) {
      throw new BadRequestException(
        `A maximum of ${MAX_INVENTORY_PHOTOS} photos can be uploaded at once`,
      );
    }

    // Authorize once up front rather than per file.
    if (meta.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        meta.warehouseId,
      );
    }

    const uploaded: Array<ReturnType<PhotosService['toDto']>> = [];
    try {
      for (const file of files) {
        uploaded.push(await this.upload(file, meta, actor));
      }
    } catch (err) {
      await Promise.all(
        uploaded.map((p) =>
          this.remove(p.id, actor).catch(() => {
            /* best-effort rollback; the original error is what matters */
          }),
        ),
      );
      throw err;
    }

    return uploaded;
  }

  async list(
    actor: AuthenticatedUser,
    filters: {
      from?: Date;
      to?: Date;
      userId?: number;
      warehouseId?: string;
      customerId?: string;
      jobReference?: string;
      photoType?: string;
    },
  ) {
    if (filters.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        filters.warehouseId,
      );
    }

    const qb = this.photoRepository
      .createQueryBuilder('photo')
      .orderBy('photo.takenAt', 'DESC');

    // IDOR guard: staff/driver can only ever see their own photos
    if (!PRIVILEGED_ROLES.includes(actor.role)) {
      qb.andWhere('photo.takenBy = :ownerId', { ownerId: actor.id });
    } else if (filters.userId) {
      qb.andWhere('photo.takenBy = :ownerId', { ownerId: filters.userId });
    }

    if (filters.warehouseId) {
      qb.andWhere('photo.warehouseId = :warehouseId', {
        warehouseId: filters.warehouseId,
      });
    } else if (
      PRIVILEGED_ROLES.includes(actor.role) &&
      !actor.hasGlobalAccess &&
      (!actor.permissions ||
        !actor.permissions.includes('warehouses:global_access'))
    ) {
      const authorizedIds =
        await this.warehousesService.getUserAuthorizedWarehouseIds(
          actor.id,
          actor.role,
          actor.permissions,
        );
      if (authorizedIds.length === 0) {
        qb.andWhere('photo.warehouseId IS NULL');
      } else {
        qb.andWhere(
          '(photo.warehouseId IN (:...authorizedIds) OR photo.warehouseId IS NULL)',
          { authorizedIds },
        );
      }
    }

    if (filters.from)
      qb.andWhere('photo.takenAt >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('photo.takenAt <= :to', { to: filters.to });
    if (filters.customerId)
      qb.andWhere('photo.customerId = :customerId', {
        customerId: filters.customerId,
      });
    if (filters.jobReference)
      qb.andWhere('photo.jobReference = :jobReference', {
        jobReference: filters.jobReference,
      });
    if (filters.photoType)
      qb.andWhere('photo.photoType = :photoType', {
        photoType: filters.photoType,
      });

    const photos = await qb.getMany();
    return photos.map((photo) => this.toDto(photo));
  }

  async findOneAuthorized(id: string, actor: AuthenticatedUser) {
    const photo = await this.photoRepository.findOne({ where: { id } });
    if (!photo) throw new NotFoundException('Photo not found');

    if (!PRIVILEGED_ROLES.includes(actor.role) && photo.takenBy !== actor.id) {
      throw new ForbiddenException('Not authorized to view this photo');
    }

    if (photo.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        photo.warehouseId,
      );
    }

    return this.toDto(photo);
  }

  async getPhotoStream(id: string, actor: AuthenticatedUser) {
    const photo = await this.photoRepository.findOne({ where: { id } });
    if (!photo) throw new NotFoundException('Photo not found');

    if (!PRIVILEGED_ROLES.includes(actor.role) && photo.takenBy !== actor.id) {
      throw new ForbiddenException('Not authorized to view this photo');
    }

    if (photo.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        photo.warehouseId,
      );
    }

    try {
      const stream = await this.storageService.getObject(photo.objectKey);
      return { stream, photo };
    } catch (err: any) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException('Photo storage object not found');
      }
      throw err;
    }
  }

  async remove(id: string, actor: AuthenticatedUser) {
    const photo = await this.photoRepository.findOne({ where: { id } });
    if (!photo) throw new NotFoundException('Photo not found');

    if (photo.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        photo.warehouseId,
      );
    }

    await this.storageService.delete(photo.objectKey);
    await this.photoRepository.delete(id);

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'photo.deleted',
      entityType: 'photo',
      entityId: id,
      warehouseId: photo.warehouseId,
      summary: `${actor.email} deleted a photo`,
    });
  }

  toDto(photo: PhotoAsset) {
    return {
      id: photo.id,
      url: `/api/photos/${photo.id}/view`,
      thumbnailUrl: `/api/photos/${photo.id}/thumbnail`,
      downloadUrl: `/api/photos/${photo.id}/download`,
      originalFilename: photo.originalFilename,
      mimeType: photo.mimeType,
      // pg/TypeORM returns `bigint` columns as strings to avoid precision
      // loss beyond Number.MAX_SAFE_INTEGER; photo sizes never approach
      // that, and the frontend sums this across many photos with `+`, which
      // silently does string concatenation instead of addition if this
      // stays a string (e.g. "0" + "552" + "552" -> "0552552" -> a bogus
      // multi-hundred-sextillion "MB" total once divided and formatted).
      sizeBytes: Number(photo.sizeBytes),
      warehouseId: photo.warehouseId,
      customerId: photo.customerId,
      jobReference: photo.jobReference,
      photoType: photo.photoType,
      takenBy: photo.takenBy,
      takenAt: photo.takenAt,
      createdAt: photo.createdAt,
    };
  }
}
