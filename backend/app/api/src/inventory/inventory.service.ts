import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { FindOptionsWhere, In, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  DIVISION_STORAGE_WRITE_VALUE,
  normalizeDivision,
} from '../divisions/divisions.constants';
import { DivisionsService } from '../divisions/divisions.service';
import { MAX_INVENTORY_PHOTOS } from '../common/photo-limits';

import { Material } from '../materials/entities/material.entity';
import { PhotoAsset } from '../photos/entities/photo-asset.entity';
import { StorageService } from '../storage/storage.service';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CreateContainerDto } from './dto/create-container.dto';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';
import { Container } from './entities/container.entity';
import { InventoryBalance } from './entities/inventory-balance.entity';
import { InventoryTransaction } from './entities/inventory-transaction.entity';

export interface ListTransactionsFilter {
  warehouseId?: string;
  division?: string;
  materialId?: string;
  type?: string;
  search?: string;
  orderNumber?: string;
  containerNumber?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Container)
    private readonly containerRepository: Repository<Container>,
    @InjectRepository(InventoryTransaction)
    private readonly transactionRepository: Repository<InventoryTransaction>,
    @InjectRepository(InventoryBalance)
    private readonly balanceRepository: Repository<InventoryBalance>,
    @InjectRepository(Material)
    private readonly materialRepository: Repository<Material>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepository: Repository<Warehouse>,
    @InjectRepository(PhotoAsset)
    private readonly photoRepository: Repository<PhotoAsset>,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly warehousesService: WarehousesService,
    private readonly divisionsService: DivisionsService,
  ) {}

  private validateDivisionAndUnitType(
    division?: string,
    unitType?: string,
    hasSizes = false,
  ) {
    // Normalise first so the canonical `greenwave` key and the legacy
    // `recycling` storage value are both accepted, then keep working in the
    // storage vocabulary the rest of this method (and the columns) use.
    const normalized = division ? normalizeDivision(division) : null;
    if (division && !normalized) {
      throw new BadRequestException(
        'division must be either greenwave (recycling) or healthcare',
      );
    }
    const div = normalized
      ? DIVISION_STORAGE_WRITE_VALUE[normalized]
      : hasSizes || unitType === 'box'
        ? 'healthcare'
        : 'recycling';
    const unit = unitType
      ? unitType.toLowerCase()
      : div === 'healthcare'
        ? 'box'
        : 'pallet';

    if (!['recycling', 'healthcare'].includes(div)) {
      throw new BadRequestException(
        'division must be either recycling or healthcare',
      );
    }
    if (!['pallet', 'box'].includes(unit)) {
      throw new BadRequestException('unitType must be either pallet or box');
    }
    if (div === 'recycling' && unit === 'box') {
      throw new BadRequestException('Recycling division handles pallets only');
    }
    if (div === 'healthcare' && unit === 'pallet') {
      throw new BadRequestException('Healthcare division handles boxes only');
    }
    return { division: div, unitType: unit };
  }

  private validateQuantities(quantities: {
    [key: string]: number | undefined;
  }) {
    for (const [key, val] of Object.entries(quantities)) {
      if (val !== undefined && val !== null) {
        if (!Number.isInteger(Number(val)) || Number(val) < 0) {
          throw new BadRequestException(
            `Quantity field ${key} must be a whole number (no decimal fractions)`,
          );
        }
      }
    }
  }

  private validateWeight(weightValue?: number, weightUnit?: string) {
    if (weightValue !== undefined && weightValue !== null) {
      const num = Number(weightValue);
      if (isNaN(num) || num < 0) {
        throw new BadRequestException(
          'weightValue must be a valid non-negative number',
        );
      }
      if (!weightUnit || !['kg', 'lb'].includes(weightUnit.toLowerCase())) {
        throw new BadRequestException('weightUnit must be either kg or lb');
      }
      return {
        weightValue: num,
        weightUnit: weightUnit.toLowerCase(),
      };
    }
    if (weightUnit) {
      if (!['kg', 'lb'].includes(weightUnit.toLowerCase())) {
        throw new BadRequestException('weightUnit must be either kg or lb');
      }
      return {
        weightValue: null,
        weightUnit: weightUnit.toLowerCase(),
      };
    }
    return { weightValue: null, weightUnit: null };
  }

  async createContainer(dto: CreateContainerDto, actor: AuthenticatedUser) {
    await this.warehousesService.assertWarehouseAccess(actor, dto.warehouseId);
    this.validateQuantities({
      xl: dto.xl,
      l: dto.l,
      m: dto.m,
      s: dto.s,
      total: dto.total,
    });
    const hasSizes =
      (dto.l && dto.l > 0) || (dto.m && dto.m > 0) || (dto.s && dto.s > 0);
    const { division, unitType } = this.validateDivisionAndUnitType(
      dto.division,
      dto.unitType,
      !!hasSizes,
    );
    const { weightValue, weightUnit } = this.validateWeight(
      dto.weightValue,
      dto.weightUnit,
    );
    // `division` here has already been resolved by validateDivisionAndUnitType
    // (which may have inferred it from unitType). Authorize the resolved
    // value, not the raw input, so an inferred division cannot bypass the
    // check.
    await this.divisionsService.assertStoredDivisionAccess(actor, division);

    if (normalizeDivision(dto.division) === 'greenwave' && hasSizes) {
      throw new BadRequestException(
        'Recycling division handles pallets only and does not use size breakdown (XL/L/M/S)',
      );
    }

    const xl = Math.round(dto.xl ?? 0);
    const l = Math.round(dto.l ?? 0);
    const m = Math.round(dto.m ?? 0);
    const s = Math.round(dto.s ?? 0);
    const calculatedTotal = xl + l + m + s;
    const total =
      dto.total !== undefined && dto.total > 0
        ? Math.round(dto.total)
        : calculatedTotal;

    const container = this.containerRepository.create({
      id: randomUUID(),
      warehouseId: dto.warehouseId,
      orderNumber: dto.orderNumber ?? null,
      blNumber: dto.blNumber ?? null,
      shippingLine: dto.shippingLine ?? null,
      containerNumber: dto.containerNumber ?? null,
      sealNumber: dto.sealNumber ?? null,
      productName: dto.productName ?? null,
      materialId: dto.materialId ?? null,
      unitType,
      division,
      weightValue: weightValue !== null ? String(weightValue) : null,
      weightUnit,
      photoId: dto.photoId ?? null,
      xl: String(xl),
      l: String(l),
      m: String(m),
      s: String(s),
      total: String(total),
      eta: dto.eta ?? null,
      status: dto.status || 'in_transit',
      notes: dto.notes ?? null,
      createdBy: actor.id,
    });

    return this.containerRepository.save(container);
  }

  async listContainers(
    actor: AuthenticatedUser,
    warehouseId?: string,
    division?: string,
    search?: string,
  ) {
    if (warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, warehouseId);
    }

    const qb = this.containerRepository.createQueryBuilder('c');

    if (warehouseId) {
      qb.andWhere('c.warehouseId = :warehouseId', { warehouseId });
    } else if (
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
      if (authorizedIds.length === 0) return [];
      qb.andWhere('c.warehouseId IN (:...authorizedIds)', { authorizedIds });
    }

    const divisionValues =
      await this.divisionsService.scopeDivisionStorageValues(actor, division);
    if (divisionValues.length === 0) return [];
    qb.andWhere('c.division IN (:...divisionValues)', { divisionValues });

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      qb.andWhere(
        '(c.containerNumber ILIKE :q OR c.sealNumber ILIKE :q OR c.orderNumber ILIKE :q OR c.blNumber ILIKE :q OR c.productName ILIKE :q)',
        { q },
      );
    }
    qb.orderBy('c.createdAt', 'DESC');
    return qb.getMany();
  }

  /**
   * Validate and de-duplicate the photos a caller wants attached to an entry.
   *
   * This is an authorization boundary, not just a tidy-up: without it a staff
   * user could post an arbitrary photo UUID and then read the image back
   * through the transaction detail view, which returns attached photos
   * without re-checking each one. So every id is confirmed to exist, to sit
   * in the same warehouse as the entry (or be unscoped), and — for
   * non-privileged roles — to have been taken by the caller.
   */
  private async resolveAttachedPhotos(
    dto: CreateInventoryTransactionDto,
    actor: AuthenticatedUser,
  ): Promise<string[]> {
    const requested =
      dto.photoIds && dto.photoIds.length > 0
        ? dto.photoIds
        : dto.photoId
          ? [dto.photoId]
          : [];

    // Preserve caller order while dropping repeats — the first surviving
    // entry is the cover photo.
    const unique = Array.from(new Set(requested));
    if (unique.length === 0) return [];

    if (unique.length > MAX_INVENTORY_PHOTOS) {
      throw new BadRequestException(
        `A maximum of ${MAX_INVENTORY_PHOTOS} photos can be attached to one inventory entry`,
      );
    }

    const photos = await this.photoRepository.find({
      where: { id: In(unique) },
    });
    const byId = new Map(photos.map((photo) => [photo.id, photo]));

    const missing = unique.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Photo not found: ${missing.join(', ')}. Re-attach the photos and try again.`,
      );
    }

    const privileged = actor.role === 'admin' || actor.role === 'manager';
    for (const id of unique) {
      const photo = byId.get(id)!;
      if (!privileged && photo.takenBy !== actor.id) {
        throw new ForbiddenException(
          'You can only attach photos that you uploaded',
        );
      }
      if (photo.warehouseId && photo.warehouseId !== dto.warehouseId) {
        throw new ForbiddenException(
          'Photos must belong to the same warehouse as the inventory entry',
        );
      }
    }

    return unique;
  }

  /**
   * Bind a photo set to the entry that now owns it.
   *
   * Photos are uploaded before the transaction exists, so they are tagged at
   * upload time with the operator's order number and found again by the
   * reference match in getTransactionById. That match is left intact — it is
   * what makes an order's photos discoverable in the photo library, and what
   * keeps already-stored photos visible.
   *
   * The gap it leaves is an entry with no order number: those photos carry no
   * reference at all and would be orphaned the moment the modal closed. Only
   * those get stamped with the transaction id, which the same reference match
   * already looks for.
   */
  private async bindPhotosToTransaction(
    photoIds: string[],
    transactionId: string,
  ): Promise<void> {
    if (photoIds.length === 0) return;
    try {
      await this.photoRepository
        .createQueryBuilder()
        .update(PhotoAsset)
        .set({ jobReference: transactionId })
        .where('id IN (:...photoIds)', { photoIds })
        .andWhere("(job_reference IS NULL OR job_reference = '')")
        .execute();
    } catch {
      // The photos are already stored and the entry is already saved; a
      // failure to stamp the reference must not fail the transaction.
    }
  }

  async createTransaction(
    dto: CreateInventoryTransactionDto,
    actor: AuthenticatedUser,
  ) {
    await this.warehousesService.assertWarehouseAccess(actor, dto.warehouseId);
    this.validateQuantities({ xl: dto.xl, l: dto.l, m: dto.m, s: dto.s });
    const hasSizes =
      (dto.l && dto.l > 0) || (dto.m && dto.m > 0) || (dto.s && dto.s > 0);
    const { division, unitType } = this.validateDivisionAndUnitType(
      dto.division,
      dto.unitType,
      !!hasSizes,
    );
    const { weightValue, weightUnit } = this.validateWeight(
      dto.weightValue,
      dto.weightUnit,
    );

    await this.divisionsService.assertStoredDivisionAccess(actor, division);

    if (normalizeDivision(dto.division) === 'healthcare') {
      if (weightValue !== null || weightUnit !== null) {
        throw new BadRequestException(
          'Healthcare division handles boxes only and does not use weight (kg/lb)',
        );
      }
    }

    if (normalizeDivision(dto.division) === 'greenwave' && hasSizes) {
      throw new BadRequestException(
        'Recycling division handles pallets only and does not use size breakdown (XL/L/M/S)',
      );
    }

    if (dto.type === 'adjustment') {
      if (!dto.reason || dto.reason.trim().length === 0) {
        throw new BadRequestException('reason is required for adjustments');
      }
      if (!['admin', 'manager'].includes(actor.role)) {
        throw new ForbiddenException(
          'Adjustments require a manager or administrator',
        );
      }
    }

    const xl = Math.round(dto.xl ?? 0);
    const l = Math.round(dto.l ?? 0);
    const m = Math.round(dto.m ?? 0);
    const s = Math.round(dto.s ?? 0);
    // Automatic server calculation of Total = XL + L + M + S
    const total = xl + l + m + s;

    let createdAt: Date | undefined = undefined;
    if (dto.date) {
      const parts = dto.date.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const now = new Date();
        createdAt = new Date(
          Date.UTC(
            year,
            month,
            day,
            now.getUTCHours(),
            now.getUTCMinutes(),
            now.getUTCSeconds(),
            now.getUTCMilliseconds(),
          ),
        );
      } else {
        const parsed = new Date(dto.date);
        if (!isNaN(parsed.getTime())) {
          createdAt = parsed;
        }
      }
    }

    // Resolve the photo set for this entry. `photoIds` is the multi-photo
    // path; `photoId` remains accepted so older clients (and anything
    // replaying a stored payload) keep working. The first entry becomes the
    // cover photo written to the scalar `photo_id` column.
    const attachedPhotoIds = await this.resolveAttachedPhotos(dto, actor);
    const coverPhotoId = attachedPhotoIds[0] ?? null;

    const transaction = this.transactionRepository.create({
      id: randomUUID(),
      warehouseId: dto.warehouseId,
      materialId: dto.materialId,
      containerId: dto.containerId ?? null,
      type: dto.type,
      unitType,
      division,
      weightValue: weightValue !== null ? String(weightValue) : null,
      weightUnit,
      photoId: coverPhotoId,
      xl: String(xl),
      l: String(l),
      m: String(m),
      s: String(s),
      total: String(total),
      reason: dto.reason ?? null,
      reference: dto.reference ?? dto.orderNumber ?? null,
      orderNumber: dto.orderNumber ?? dto.reference ?? null,
      containerNumber: dto.containerNumber ?? null,
      sealNumber: dto.sealNumber ?? null,
      notes: dto.notes ?? null,
      createdBy: actor.id,
      createdAt,
    });

    const saved = await this.transactionRepository.save(transaction);

    await this.bindPhotosToTransaction(attachedPhotoIds, saved.id);

    // Link/trace container record if container number provided
    if (!dto.containerId && (dto.containerNumber || dto.sealNumber)) {
      try {
        const container = await this.createContainer(
          {
            warehouseId: dto.warehouseId,
            orderNumber: dto.orderNumber ?? dto.reference,
            containerNumber: dto.containerNumber,
            sealNumber: dto.sealNumber,
            materialId: dto.materialId,
            unitType: unitType as 'pallet' | 'box',
            division: division as 'recycling' | 'healthcare',
            weightValue: weightValue ?? undefined,
            weightUnit: (weightUnit as 'kg' | 'lb') ?? undefined,
            photoId: coverPhotoId ?? undefined,
            xl,
            l,
            m,
            s,
            total,
            status:
              dto.type === 'inbound'
                ? 'received'
                : dto.type === 'outbound'
                  ? 'dispatched'
                  : 'adjusted',
            notes: dto.notes ?? dto.reason,
          },
          actor,
        );
        if (container && container.id) {
          saved.containerId = container.id;
          await this.transactionRepository.update(saved.id, {
            containerId: container.id,
          });
        }
      } catch {
        // Trace container failure should not fail transaction
      }
    }

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: `inventory.${dto.type}`,
      entityType: 'inventory_transaction',
      entityId: saved.id,
      warehouseId: dto.warehouseId,
      summary:
        dto.type === 'adjustment'
          ? `${actor.email} adjusted stock by ${total} ${unitType}s (${division}) (reason: ${dto.reason})`
          : `${actor.email} recorded ${dto.type} of ${total} ${unitType}s (${division})${weightValue ? ` [${weightValue} ${weightUnit?.toUpperCase()}]` : ''}`,
      metadata: {
        materialId: dto.materialId,
        containerId: dto.containerId ?? null,
        orderNumber: dto.orderNumber ?? null,
        containerNumber: dto.containerNumber ?? null,
        sealNumber: dto.sealNumber ?? null,
        unitType,
        division,
        weightValue,
        weightUnit,
        photoId: coverPhotoId,
        photoCount: attachedPhotoIds.length,
        xl,
        l,
        m,
        s,
        total,
      },
    });

    return saved;
  }

  async getTransactionById(id: string, actor: AuthenticatedUser) {
    const tx = await this.transactionRepository.findOne({ where: { id } });
    if (!tx) {
      throw new NotFoundException('Inventory transaction not found');
    }

    await this.warehousesService.assertWarehouseAccess(actor, tx.warehouseId);
    // Direct-by-UUID lookup must clear the division boundary too, otherwise
    // knowing a Healthcare transaction id would be enough to read it.
    await this.divisionsService.assertStoredDivisionAccess(actor, tx.division);

    let container: Container | null = null;
    if (tx.containerId) {
      container = await this.containerRepository.findOne({
        where: { id: tx.containerId },
      });
    }
    if (!container && tx.containerNumber) {
      container = await this.containerRepository.findOne({
        where: {
          warehouseId: tx.warehouseId,
          containerNumber: tx.containerNumber,
        },
      });
    }
    if (!container && tx.orderNumber) {
      container = await this.containerRepository.findOne({
        where: { warehouseId: tx.warehouseId, orderNumber: tx.orderNumber },
      });
    }

    const [warehouse, material, creator] = await Promise.all([
      this.warehouseRepository.findOne({ where: { id: tx.warehouseId } }),
      this.materialRepository.findOne({ where: { id: tx.materialId } }),
      this.userRepository.findOne({ where: { id: tx.createdBy } }),
    ]);

    // Find associated photos across photoId, container.photoId, and reference keys
    const photoQb = this.photoRepository.createQueryBuilder('p');
    const refs = [
      tx.orderNumber,
      tx.reference,
      tx.containerNumber,
      tx.id,
      container?.containerNumber,
      container?.orderNumber,
    ].filter(Boolean) as string[];

    const photoIdConditions: string[] = [];
    const params: Record<string, any> = {
      warehouseId: tx.warehouseId,
    };

    if (tx.photoId) {
      photoIdConditions.push('p.id = :txPhotoId');
      params.txPhotoId = tx.photoId;
    }
    if (container?.photoId && container.photoId !== tx.photoId) {
      photoIdConditions.push('p.id = :cPhotoId');
      params.cPhotoId = container.photoId;
    }

    if (photoIdConditions.length > 0 && refs.length > 0) {
      photoQb.where(
        `(${photoIdConditions.join(' OR ')} OR ((p.warehouseId = :warehouseId OR p.warehouseId IS NULL) AND p.jobReference IN (:...refs)))`,
        { ...params, refs },
      );
    } else if (photoIdConditions.length > 0) {
      photoQb.where(`(${photoIdConditions.join(' OR ')})`, params);
    } else if (refs.length > 0) {
      photoQb.where(
        '((p.warehouseId = :warehouseId OR p.warehouseId IS NULL) AND p.jobReference IN (:...refs))',
        { warehouseId: tx.warehouseId, refs },
      );
    } else {
      photoQb.where(
        '(p.warehouseId = :warehouseId OR p.warehouseId IS NULL) AND p.jobReference = :txId',
        {
          warehouseId: tx.warehouseId,
          txId: tx.id,
        },
      );
    }

    const photoAssets = await photoQb.getMany();
    const photos = photoAssets.map((p) => {
      return {
        id: p.id,
        url: `/api/photos/${p.id}/view`,
        thumbnailUrl: `/api/photos/${p.id}/thumbnail`,
        downloadUrl: `/api/photos/${p.id}/download`,
        originalFilename: p.originalFilename,
        mimeType: p.mimeType,
        sizeBytes: Number(p.sizeBytes),
        photoType: p.photoType,
        takenBy: p.takenBy,
        takenAt: p.takenAt,
        createdAt: p.createdAt,
      };
    });

    return {
      id: tx.id,
      warehouseId: tx.warehouseId,
      warehouseName: warehouse?.name || '—',
      warehouseCode: warehouse?.code || '—',
      materialId: tx.materialId,
      materialName: material?.name || '—',
      materialCategory: material?.category || '—',
      materialUnit: material?.unit || '—',
      containerId: tx.containerId || container?.id || null,
      type: tx.type,
      unitType:
        tx.unitType || (tx.division === 'healthcare' ? 'box' : 'pallet'),
      division: tx.division || 'recycling',
      weightValue: tx.weightValue ? Number(tx.weightValue) : null,
      weightUnit: tx.weightUnit || null,
      photoId: tx.photoId,
      xl: Number(tx.xl),
      l: Number(tx.l),
      m: Number(tx.m),
      s: Number(tx.s),
      total: Number(tx.total),
      reason: tx.reason || '—',
      reference: tx.reference || tx.orderNumber || '—',
      orderNumber:
        tx.orderNumber || tx.reference || container?.orderNumber || '—',
      containerNumber: tx.containerNumber || container?.containerNumber || '—',
      sealNumber: tx.sealNumber || container?.sealNumber || '—',
      blNumber: container?.blNumber || '—',
      shippingLine: container?.shippingLine || '—',
      eta: container?.eta || '—',
      notes: tx.notes || container?.notes || '—',
      createdBy: tx.createdBy,
      creatorName: creator?.fullName || creator?.email || '—',
      creatorEmail: creator?.email || '—',
      creatorRole: creator?.role || '—',
      date: tx.createdAt
        ? new Date(tx.createdAt).toISOString().split('T')[0]
        : null,
      time: tx.createdAt
        ? new Date(tx.createdAt).toISOString().split('T')[1].split('.')[0]
        : null,
      createdAt: tx.createdAt,
      photos,
    };
  }

  async listTransactions(
    actor: AuthenticatedUser,
    filters?: ListTransactionsFilter,
  ) {
    if (filters?.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        filters.warehouseId,
      );
    }

    const qb = this.transactionRepository.createQueryBuilder('tx');

    if (filters?.warehouseId) {
      qb.andWhere('tx.warehouseId = :warehouseId', {
        warehouseId: filters.warehouseId,
      });
    } else if (
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
      if (authorizedIds.length === 0) return [];
      qb.andWhere('tx.warehouseId IN (:...authorizedIds)', { authorizedIds });
    }

    const divisionValues =
      await this.divisionsService.scopeDivisionStorageValues(
        actor,
        filters?.division,
      );
    if (divisionValues.length === 0) return [];
    qb.andWhere('tx.division IN (:...divisionValues)', { divisionValues });
    if (filters?.materialId) {
      qb.andWhere('tx.materialId = :materialId', {
        materialId: filters.materialId,
      });
    }
    if (filters?.type) {
      qb.andWhere('tx.type = :type', { type: filters.type });
    }
    if (filters?.orderNumber) {
      qb.andWhere('tx.orderNumber = :orderNumber', {
        orderNumber: filters.orderNumber,
      });
    }
    if (filters?.containerNumber) {
      qb.andWhere('tx.containerNumber = :containerNumber', {
        containerNumber: filters.containerNumber,
      });
    }
    if (filters?.startDate) {
      qb.andWhere('tx.createdAt >= :startDate', {
        startDate: filters.startDate,
      });
    }
    if (filters?.endDate) {
      qb.andWhere('tx.createdAt <= :endDate', { endDate: filters.endDate });
    }
    if (filters?.search && filters.search.trim()) {
      const q = `%${filters.search.trim()}%`;
      qb.andWhere(
        '(tx.orderNumber ILIKE :q OR tx.reference ILIKE :q OR tx.containerNumber ILIKE :q OR tx.sealNumber ILIKE :q OR tx.reason ILIKE :q OR tx.notes ILIKE :q)',
        { q },
      );
    }

    qb.orderBy('tx.createdAt', 'DESC');
    return qb.getMany();
  }

  async getBalances(
    actor: AuthenticatedUser,
    warehouseId?: string,
    division?: string,
  ) {
    const where: FindOptionsWhere<InventoryBalance> = {};

    // Warehouse authorization is asserted first so an unauthorized facility
    // still returns 403 rather than being masked by an empty division scope.
    if (warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, warehouseId);
    }

    // warehouse + division together: the balances view is grouped by both, so
    // scoping both here is what keeps e.g. "Calgary + Healthcare" invisible to
    // a Calgary GreenWave-only user.
    const divisionValues =
      await this.divisionsService.scopeDivisionStorageValues(actor, division);
    if (divisionValues.length === 0) return [];
    where.division = In(divisionValues);

    if (warehouseId) {
      where.warehouseId = warehouseId;
      return this.balanceRepository.find({ where });
    }

    if (
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
      if (authorizedIds.length === 0) return [];
      where.warehouseId = In(authorizedIds);
      return this.balanceRepository.find({ where });
    }

    return this.balanceRepository.find({ where });
  }

  async findContainer(id: string, actor?: AuthenticatedUser) {
    const container = await this.containerRepository.findOne({ where: { id } });
    if (!container) throw new NotFoundException('Container not found');
    if (actor) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        container.warehouseId,
      );
      await this.divisionsService.assertStoredDivisionAccess(
        actor,
        container.division,
      );
    }
    return container;
  }
}
