import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { UploadPhotoMetadataDto } from './dto/upload-photo-metadata.dto';
import { PhotoAsset } from './entities/photo-asset.entity';

interface Actor {
  id: number;
  role: string;
  email: string;
}

const PRIVILEGED_ROLES = ['admin', 'manager'];

@Injectable()
export class PhotosService {
  constructor(
    @InjectRepository(PhotoAsset)
    private readonly photoRepository: Repository<PhotoAsset>,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
  ) {}

  async upload(
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    meta: UploadPhotoMetadataDto,
    actor: Actor,
  ) {
    const id = randomUUID();
    const scope = meta.warehouseId ?? 'general';
    const objectKey = `photos/${scope}/${id}-${file.originalname}`;

    await this.storageService.upload(objectKey, file.buffer, file.mimetype);

    const photo = this.photoRepository.create({
      id,
      objectKey,
      bucketName: this.storageService.getBucketName(),
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
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

  async list(
    actor: Actor,
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
    const qb = this.photoRepository.createQueryBuilder('photo').orderBy('photo.takenAt', 'DESC');

    // IDOR guard: staff/driver can only ever see their own photos, no
    // matter what userId a caller puts in the query string.
    if (!PRIVILEGED_ROLES.includes(actor.role)) {
      qb.andWhere('photo.takenBy = :ownerId', { ownerId: actor.id });
    } else if (filters.userId) {
      qb.andWhere('photo.takenBy = :ownerId', { ownerId: filters.userId });
    }

    if (filters.from) qb.andWhere('photo.takenAt >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('photo.takenAt <= :to', { to: filters.to });
    if (filters.warehouseId) qb.andWhere('photo.warehouseId = :warehouseId', { warehouseId: filters.warehouseId });
    if (filters.customerId) qb.andWhere('photo.customerId = :customerId', { customerId: filters.customerId });
    if (filters.jobReference) qb.andWhere('photo.jobReference = :jobReference', { jobReference: filters.jobReference });
    if (filters.photoType) qb.andWhere('photo.photoType = :photoType', { photoType: filters.photoType });

    const photos = await qb.getMany();
    return Promise.all(photos.map((photo) => this.toDto(photo)));
  }

  async findOneAuthorized(id: string, actor: Actor) {
    const photo = await this.photoRepository.findOne({ where: { id } });
    if (!photo) throw new NotFoundException('Photo not found');

    // Re-checked here too, not just in list(): a direct GET /photos/:id by
    // guessed/sequential id must not leak another staff member's photo.
    if (!PRIVILEGED_ROLES.includes(actor.role) && photo.takenBy !== actor.id) {
      throw new ForbiddenException('Not authorized to view this photo');
    }

    return this.toDto(photo);
  }

  async remove(id: string, actor: Actor) {
    const photo = await this.photoRepository.findOne({ where: { id } });
    if (!photo) throw new NotFoundException('Photo not found');

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

  private async toDto(photo: PhotoAsset) {
    const url = await this.storageService.presignedGetUrl(photo.objectKey);
    return {
      id: photo.id,
      url,
      originalFilename: photo.originalFilename,
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      warehouseId: photo.warehouseId,
      customerId: photo.customerId,
      jobReference: photo.jobReference,
      photoType: photo.photoType,
      takenBy: photo.takenBy,
      takenAt: photo.takenAt,
    };
  }
}
