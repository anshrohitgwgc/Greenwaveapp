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
  ) {}

  private validateDivisionAndUnitType(
    division?: string,
    unitType?: string,
    hasSizes = false,
  ) {
    const div = division
      ? division.toLowerCase()
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

    if (dto.division === 'recycling' && hasSizes) {
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

    if (division) {
      qb.andWhere('c.division = :division', {
        division: division.toLowerCase(),
      });
    }

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

    if (dto.division === 'healthcare') {
      if (weightValue !== null || weightUnit !== null) {
        throw new BadRequestException(
          'Healthcare division handles boxes only and does not use weight (kg/lb)',
        );
      }
    }

    if (dto.division === 'recycling' && hasSizes) {
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
      photoId: dto.photoId ?? null,
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
    });

    const saved = await this.transactionRepository.save(transaction);

    // Link/trace container record if container number provided
    if (!dto.containerId && (dto.containerNumber || dto.sealNumber)) {
      try {
        await this.createContainer(
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
            photoId: dto.photoId,
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
        photoId: dto.photoId ?? null,
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

    const [warehouse, material, creator, container] = await Promise.all([
      this.warehouseRepository.findOne({ where: { id: tx.warehouseId } }),
      this.materialRepository.findOne({ where: { id: tx.materialId } }),
      this.userRepository.findOne({ where: { id: tx.createdBy } }),
      tx.containerId
        ? this.containerRepository.findOne({ where: { id: tx.containerId } })
        : null,
    ]);

    // Find associated photos
    const photoQb = this.photoRepository
      .createQueryBuilder('p')
      .where('p.warehouseId = :warehouseId', { warehouseId: tx.warehouseId });

    if (tx.photoId) {
      photoQb.andWhere(
        '(p.id = :photoId OR p.jobReference = :ref OR p.jobReference = :orderNum)',
        {
          photoId: tx.photoId,
          ref: tx.reference || tx.orderNumber || tx.id,
          orderNum: tx.orderNumber || tx.id,
        },
      );
    } else if (tx.orderNumber || tx.reference) {
      photoQb.andWhere('p.jobReference IN (:...refs)', {
        refs: [tx.orderNumber, tx.reference, tx.id].filter(Boolean),
      });
    } else {
      photoQb.andWhere('p.jobReference = :txId', { txId: tx.id });
    }

    const photoAssets = await photoQb.getMany();
    const photos = await Promise.all(
      photoAssets.map(async (p) => {
        let presignedUrl = '';
        try {
          presignedUrl = await this.storageService.presignedGetUrl(p.objectKey);
        } catch {
          presignedUrl = `/photos/${p.id}/view`;
        }
        return {
          id: p.id,
          url: presignedUrl,
          originalFilename: p.originalFilename,
          mimeType: p.mimeType,
          sizeBytes: p.sizeBytes,
          photoType: p.photoType,
          takenBy: p.takenBy,
          takenAt: p.takenAt,
        };
      }),
    );

    return {
      id: tx.id,
      warehouseId: tx.warehouseId,
      warehouseName: warehouse?.name || '—',
      warehouseCode: warehouse?.code || '—',
      materialId: tx.materialId,
      materialName: material?.name || '—',
      materialCategory: material?.category || '—',
      materialUnit: material?.unit || '—',
      containerId: tx.containerId,
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
      reference: tx.reference || '—',
      orderNumber: tx.orderNumber || '—',
      containerNumber: tx.containerNumber || '—',
      sealNumber: tx.sealNumber || '—',
      blNumber: container?.blNumber || '—',
      shippingLine: container?.shippingLine || '—',
      eta: container?.eta || '—',
      notes: tx.notes || '—',
      createdBy: tx.createdBy,
      creatorName: creator?.fullName || creator?.email || '—',
      creatorEmail: creator?.email || '—',
      creatorRole: creator?.role || '—',
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

    if (filters?.division) {
      qb.andWhere('tx.division = :division', {
        division: filters.division.toLowerCase(),
      });
    }
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
    if (division) {
      where.division = division.toLowerCase();
    }

    if (warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, warehouseId);
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

  async findContainer(id: string) {
    const container = await this.containerRepository.findOne({ where: { id } });
    if (!container) throw new NotFoundException('Container not found');
    return container;
  }
}
