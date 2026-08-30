import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, QueryRunner, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { roundCurrency } from '../common/rounding';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceItemDto } from './dto/invoice-item.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceItem } from './entities/invoice-item.entity';
import { Invoice } from './entities/invoice.entity';

interface ComputedTotals {
  items: InvoiceItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export function computeTotals(
  invoiceId: string,
  items: InvoiceItemDto[],
  taxRate: number,
): ComputedTotals {
  let subtotal = 0;
  let discountTotal = 0;

  const builtItems = items.map((item, index) => {
    const discount = roundCurrency(item.discount ?? 0);
    const gross = roundCurrency(item.quantity * item.unitPrice - discount);
    const signedTotal = item.isRebate ? -gross : gross;

    subtotal = roundCurrency(subtotal + signedTotal);
    discountTotal = roundCurrency(discountTotal + discount);

    const entity = new InvoiceItem();
    entity.id = randomUUID();
    entity.invoiceId = invoiceId;
    entity.serviceDate = item.serviceDate ?? null;
    entity.productService = item.productService ?? 'supply';
    entity.description = item.description;
    entity.quantity = String(item.quantity);
    entity.unit = item.unit ?? null;
    entity.taxRateLabel = item.taxRateLabel ?? 'GST';
    entity.unitPrice = String(item.unitPrice);
    entity.discount = String(discount);
    entity.isRebate = item.isRebate ?? false;
    entity.lineTotal = String(signedTotal);
    entity.sortOrder = index;
    return entity;
  });

  const taxTotal = roundCurrency(subtotal * (taxRate / 100));
  const total = roundCurrency(subtotal + taxTotal);

  return { items: builtItems, subtotal, discountTotal, taxTotal, total };
}

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    @InjectRepository(InvoiceItem)
    private readonly invoiceItemRepository: Repository<InvoiceItem>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly warehousesService: WarehousesService,
  ) {}

  /**
   * Allocates the next invoice number from a single-row counter table
   * inside the caller's transaction with row locking.
   */
  private async allocateInvoiceNumber(
    queryRunner: QueryRunner,
  ): Promise<string> {
    try {
      const isPostgres = this.dataSource.options.type === 'postgres';
      const rows = (await queryRunner.query(
        `SELECT next_value FROM invoice_number_counter WHERE id = 1${isPostgres ? ' FOR UPDATE' : ''}`,
      )) as Array<{ next_value: number }>;
      if (rows && rows.length > 0) {
        const nextValue = rows[0]?.next_value ?? 1115;
        await queryRunner.query(
          `UPDATE invoice_number_counter SET next_value = next_value + 1 WHERE id = 1`,
        );
        return String(nextValue);
      }
    } catch {
      // Fallback for environments where invoice_number_counter is not seeded (e.g. in-memory SQLite)
    }

    const count = await queryRunner.manager.count(Invoice);
    return String(1115 + count);
  }

  async create(
    dto: CreateInvoiceDto,
    actor: AuthenticatedUser,
  ): Promise<Invoice> {
    if (dto.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        dto.warehouseId,
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const invoiceId = randomUUID();
      const invoiceNumber = await this.allocateInvoiceNumber(queryRunner);
      const totals = computeTotals(invoiceId, dto.items, dto.taxRate ?? 0);

      const invoice = queryRunner.manager.create(Invoice, {
        id: invoiceId,
        invoiceNumber,
        invoiceDate: dto.invoiceDate,
        dueDate: dto.dueDate ?? null,
        customerId: dto.customerId ?? null,
        companyInfo: dto.companyInfo ?? null,
        billTo: dto.billTo ?? null,
        shipTo: dto.shipTo ?? null,
        poReference: dto.poReference ?? null,
        paymentTerms: dto.paymentTerms ?? null,
        shipVia: dto.shipVia ?? 'Greenwave Recycling Truck',
        shipDate: dto.shipDate ?? null,
        subtotal: String(totals.subtotal),
        discountTotal: String(totals.discountTotal),
        taxLabel: dto.taxLabel ?? null,
        taxRate: String(dto.taxRate ?? 0),
        taxTotal: String(totals.taxTotal),
        total: String(totals.total),
        notes: dto.notes ?? null,
        terms: dto.terms ?? null,
        footer: dto.footer ?? null,
        paymentInstructions: dto.paymentInstructions ?? null,
        status: dto.status ?? 'draft',
        currency: dto.currency ?? 'CAD',
        paymentStatus: dto.paymentStatus ?? 'unpaid',
        paymentToken:
          randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
        paidAt: null,
        paymentProvider: null,
        paymentReference: null,
        warehouseId: dto.warehouseId ?? null,
        createdBy: actor.id,
        updatedBy: actor.id,
      });

      await queryRunner.manager.save(Invoice, invoice);
      await queryRunner.manager.save(InvoiceItem, totals.items);
      await queryRunner.commitTransaction();

      await this.auditService.record({
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: invoiceId,
        warehouseId: dto.warehouseId ?? null,
        summary: `${actor.email} created invoice #${invoiceNumber} (total ${totals.total})`,
      });

      return this.findOneInternal(invoiceId);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async duplicate(id: string, actor: AuthenticatedUser): Promise<Invoice> {
    const source = await this.findOneInternal(id);
    if (source.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        source.warehouseId,
      );
    }

    const dto: CreateInvoiceDto = {
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: source.dueDate ?? undefined,
      customerId: source.customerId ?? undefined,
      companyInfo: source.companyInfo ?? undefined,
      billTo: source.billTo ?? undefined,
      shipTo: source.shipTo ?? undefined,
      poReference: source.poReference ?? undefined,
      paymentTerms: source.paymentTerms ?? undefined,
      shipVia: source.shipVia ?? undefined,
      shipDate: source.shipDate ?? undefined,
      taxLabel: source.taxLabel ?? undefined,
      taxRate: Number(source.taxRate),
      notes: source.notes ?? undefined,
      terms: source.terms ?? undefined,
      footer: source.footer ?? undefined,
      paymentInstructions: source.paymentInstructions ?? undefined,
      warehouseId: source.warehouseId ?? undefined,
      status: 'draft',
      currency: source.currency ?? 'CAD',
      paymentStatus: 'unpaid',
      items: source.items.map((item) => ({
        serviceDate: item.serviceDate ?? undefined,
        productService: item.productService ?? undefined,
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unit ?? undefined,
        taxRateLabel: item.taxRateLabel ?? undefined,
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount),
        isRebate: item.isRebate,
      })),
    };
    const created = await this.create(dto, actor);
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'invoice.duplicated',
      entityType: 'invoice',
      entityId: created.id,
      warehouseId: created.warehouseId,
      summary: `${actor.email} duplicated invoice #${source.invoiceNumber} as #${created.invoiceNumber}`,
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateInvoiceDto,
    actor: AuthenticatedUser,
  ): Promise<Invoice> {
    const existing = await this.findOneInternal(id);
    if (existing.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        existing.warehouseId,
      );
    }
    if (dto.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        dto.warehouseId,
      );
    }

    const items =
      dto.items ??
      existing.items.map((item) => ({
        serviceDate: item.serviceDate ?? undefined,
        productService: item.productService ?? undefined,
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unit ?? undefined,
        taxRateLabel: item.taxRateLabel ?? undefined,
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount),
        isRebate: item.isRebate,
      }));
    const taxRate = dto.taxRate ?? Number(existing.taxRate);
    const totals = computeTotals(id, items, taxRate);

    await this.invoiceItemRepository.delete({ invoiceId: id });
    await this.invoiceItemRepository.save(totals.items);

    await this.invoiceRepository.update(id, {
      invoiceDate: dto.invoiceDate ?? existing.invoiceDate,
      dueDate: dto.dueDate ?? existing.dueDate,
      customerId: dto.customerId ?? existing.customerId,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      companyInfo: (dto.companyInfo ?? existing.companyInfo) as any,
      billTo: dto.billTo ?? existing.billTo,
      shipTo: dto.shipTo ?? existing.shipTo,
      poReference: dto.poReference ?? existing.poReference,
      paymentTerms: dto.paymentTerms ?? existing.paymentTerms,
      shipVia: dto.shipVia ?? existing.shipVia,
      shipDate: dto.shipDate ?? existing.shipDate,
      subtotal: String(totals.subtotal),
      discountTotal: String(totals.discountTotal),
      taxLabel: dto.taxLabel ?? existing.taxLabel,
      taxRate: String(taxRate),
      taxTotal: String(totals.taxTotal),
      total: String(totals.total),
      notes: dto.notes ?? existing.notes,
      terms: dto.terms ?? existing.terms,
      footer: dto.footer ?? existing.footer,
      paymentInstructions:
        dto.paymentInstructions ?? existing.paymentInstructions,
      status: dto.status ?? existing.status,
      currency: dto.currency ?? existing.currency,
      paymentStatus: dto.paymentStatus ?? existing.paymentStatus,
      warehouseId: dto.warehouseId ?? existing.warehouseId,
      updatedBy: actor.id,
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'invoice.updated',
      entityType: 'invoice',
      entityId: id,
      warehouseId: dto.warehouseId ?? existing.warehouseId,
      summary: `${actor.email} updated invoice #${existing.invoiceNumber}`,
    });

    return this.findOneInternal(id);
  }

  async findAll(
    actor: AuthenticatedUser,
    filters: {
      customerId?: string;
      warehouseId?: string;
      status?: string;
    },
  ) {
    if (filters.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        filters.warehouseId,
      );
    }

    const qb = this.invoiceRepository
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.items', 'items')
      .orderBy('inv.createdAt', 'DESC');

    if (filters.customerId) {
      qb.andWhere('inv.customerId = :customerId', {
        customerId: filters.customerId,
      });
    }

    if (filters.warehouseId) {
      qb.andWhere('inv.warehouseId = :warehouseId', {
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
      if (authorizedIds.length === 0) {
        qb.andWhere('inv.warehouseId IS NULL');
      } else {
        qb.andWhere(
          '(inv.warehouseId IN (:...authorizedIds) OR inv.warehouseId IS NULL)',
          {
            authorizedIds,
          },
        );
      }
    }

    if (filters.status) {
      qb.andWhere('inv.status = :status', { status: filters.status });
    }

    return qb.getMany();
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<Invoice> {
    const invoice = await this.findOneInternal(id);
    if (invoice.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        invoice.warehouseId,
      );
    }
    return invoice;
  }

  private async findOneInternal(id: string): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    invoice.items.sort((a, b) => a.sortOrder - b.sortOrder);
    return invoice;
  }
}
