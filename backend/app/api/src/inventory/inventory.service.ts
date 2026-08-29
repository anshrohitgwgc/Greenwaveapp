import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { roundQuantity } from '../common/rounding';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CreateContainerDto } from './dto/create-container.dto';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';
import { Container } from './entities/container.entity';
import { InventoryBalance } from './entities/inventory-balance.entity';
import { InventoryTransaction } from './entities/inventory-transaction.entity';

export interface ListTransactionsFilter {
  warehouseId?: string;
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
    private readonly auditService: AuditService,
    private readonly warehousesService: WarehousesService,
  ) {}

  async createContainer(dto: CreateContainerDto, actor: AuthenticatedUser) {
    await this.warehousesService.assertWarehouseAccess(actor, dto.warehouseId);

    const xl = roundQuantity(dto.xl ?? 0);
    const l = roundQuantity(dto.l ?? 0);
    const m = roundQuantity(dto.m ?? 0);
    const s = roundQuantity(dto.s ?? 0);
    const calculatedTotal = roundQuantity(xl + l + m + s);
    const total =
      dto.total !== undefined && dto.total > 0
        ? roundQuantity(dto.total)
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

  async listContainers(actor: AuthenticatedUser, warehouseId?: string, search?: string) {
    if (warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, warehouseId);
    }

    const qb = this.containerRepository.createQueryBuilder('c');

    if (warehouseId) {
      qb.andWhere('c.warehouseId = :warehouseId', { warehouseId });
    } else if (!actor.hasGlobalAccess && (!actor.permissions || !actor.permissions.includes('warehouses:global_access'))) {
      const authorizedIds = await this.warehousesService.getUserAuthorizedWarehouseIds(
        actor.id,
        actor.role,
        actor.permissions,
      );
      if (authorizedIds.length === 0) return [];
      qb.andWhere('c.warehouseId IN (:...authorizedIds)', { authorizedIds });
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

  async createTransaction(dto: CreateInventoryTransactionDto, actor: AuthenticatedUser) {
    await this.warehousesService.assertWarehouseAccess(actor, dto.warehouseId);

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

    const xl = roundQuantity(dto.xl ?? 0);
    const l = roundQuantity(dto.l ?? 0);
    const m = roundQuantity(dto.m ?? 0);
    const s = roundQuantity(dto.s ?? 0);
    // Automatic server calculation of Total = XL + L + M + S
    const total = roundQuantity(xl + l + m + s);

    const transaction = this.transactionRepository.create({
      id: randomUUID(),
      warehouseId: dto.warehouseId,
      materialId: dto.materialId,
      containerId: dto.containerId ?? null,
      type: dto.type,
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
          ? `${actor.email} adjusted stock by ${total} (reason: ${dto.reason})`
          : `${actor.email} recorded ${dto.type} of ${total}`,
      metadata: {
        materialId: dto.materialId,
        containerId: dto.containerId ?? null,
        orderNumber: dto.orderNumber ?? null,
        containerNumber: dto.containerNumber ?? null,
        sealNumber: dto.sealNumber ?? null,
        xl,
        l,
        m,
        s,
        total,
      },
    });

    return saved;
  }

  async listTransactions(actor: AuthenticatedUser, filters?: ListTransactionsFilter) {
    if (filters?.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, filters.warehouseId);
    }

    const qb = this.transactionRepository.createQueryBuilder('tx');

    if (filters?.warehouseId) {
      qb.andWhere('tx.warehouseId = :warehouseId', {
        warehouseId: filters.warehouseId,
      });
    } else if (!actor.hasGlobalAccess && (!actor.permissions || !actor.permissions.includes('warehouses:global_access'))) {
      const authorizedIds = await this.warehousesService.getUserAuthorizedWarehouseIds(
        actor.id,
        actor.role,
        actor.permissions,
      );
      if (authorizedIds.length === 0) return [];
      qb.andWhere('tx.warehouseId IN (:...authorizedIds)', { authorizedIds });
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

  async getBalances(actor: AuthenticatedUser, warehouseId?: string) {
    if (warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, warehouseId);
      return this.balanceRepository.find({ where: { warehouseId } });
    }

    if (!actor.hasGlobalAccess && (!actor.permissions || !actor.permissions.includes('warehouses:global_access'))) {
      const authorizedIds = await this.warehousesService.getUserAuthorizedWarehouseIds(
        actor.id,
        actor.role,
        actor.permissions,
      );
      if (authorizedIds.length === 0) return [];
      return this.balanceRepository.find({ where: { warehouseId: In(authorizedIds) } });
    }

    return this.balanceRepository.find();
  }

  async findContainer(id: string) {
    const container = await this.containerRepository.findOne({ where: { id } });
    if (!container) throw new NotFoundException('Container not found');
    return container;
  }
}
