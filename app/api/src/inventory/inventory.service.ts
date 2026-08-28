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
import { roundQuantity } from '../common/rounding';
import { CreateContainerDto } from './dto/create-container.dto';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';
import { Container } from './entities/container.entity';
import { InventoryBalance } from './entities/inventory-balance.entity';
import { InventoryTransaction } from './entities/inventory-transaction.entity';

interface Actor {
  id: number;
  role: string;
  email: string;
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
  ) {}

  createContainer(dto: CreateContainerDto, actorId: number) {
    const container = this.containerRepository.create({
      id: randomUUID(),
      ...dto,
      createdBy: actorId,
    });
    return this.containerRepository.save(container);
  }

  listContainers(warehouseId?: string) {
    if (warehouseId)
      return this.containerRepository.find({ where: { warehouseId } });
    return this.containerRepository.find();
  }

  async createTransaction(dto: CreateInventoryTransactionDto, actor: Actor) {
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
      reference: dto.reference ?? null,
      createdBy: actor.id,
    });

    const saved = await this.transactionRepository.save(transaction);

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
      },
    });

    return saved;
  }

  listTransactions(warehouseId?: string, materialId?: string) {
    const where: Record<string, string> = {};
    if (warehouseId) where.warehouseId = warehouseId;
    if (materialId) where.materialId = materialId;
    return this.transactionRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async getBalance(warehouseId: string, materialId: string): Promise<number> {
    const row = await this.balanceRepository.findOne({
      where: { warehouseId, materialId },
    });
    return row ? Number(row.balance) : 0;
  }

  getBalances(warehouseId?: string) {
    if (warehouseId)
      return this.balanceRepository.find({ where: { warehouseId } });
    return this.balanceRepository.find();
  }

  async findContainer(id: string) {
    const container = await this.containerRepository.findOne({ where: { id } });
    if (!container) throw new NotFoundException('Container not found');
    return container;
  }
}
