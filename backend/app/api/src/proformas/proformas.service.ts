import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, QueryRunner, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { roundCurrency } from '../common/rounding';
import { Customer } from '../customers/entities/customer.entity';
import {
  assertGreenWaveRecyclingFinanceAccess,
} from '../common/guards/recycling-finance.guard';
import { InvoicesService } from '../invoices/invoices.service';
import { MailService } from '../mail/mail.service';
import { Material } from '../materials/entities/material.entity';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';
import { UpdateProformaInvoiceDto } from './dto/update-proforma-invoice.dto';
import { ProformaInvoice, ProformaStatus } from './entities/proforma-invoice.entity';
import { ProformaInvoiceItem } from './entities/proforma-invoice-item.entity';

export interface ListProformasQuery {
  status?: ProformaStatus;
  warehouseId?: string;
  customerId?: string;
  search?: string;
}

@Injectable()
export class ProformasService {
  private readonly logger = new Logger(ProformasService.name);

  constructor(
    @InjectRepository(ProformaInvoice)
    private readonly proformaRepo: Repository<ProformaInvoice>,
    @InjectRepository(ProformaInvoiceItem)
    private readonly itemRepo: Repository<ProformaInvoiceItem>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Material)
    private readonly materialRepo: Repository<Material>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly warehousesService: WarehousesService,
    private readonly invoicesService: InvoicesService,
    private readonly auditService: AuditService,
    @Optional() private readonly mailService?: MailService,
  ) {}

  /**
   * Concurrency-safe allocation of next proforma invoice number.
   * Format: PF-0001, PF-0002, etc.
   * Independent of real invoice sequence.
   */
  async allocateProformaNumber(queryRunner: QueryRunner): Promise<string> {
    if (this.dataSource.options.type === 'postgres') {
      const rows = (await queryRunner.query(
        `SELECT nextval('proforma_invoice_number_seq') AS val`,
      )) as Array<{ val: string | number }>;
      const next = Number(rows?.[0]?.val);
      if (!Number.isFinite(next)) {
        throw new Error('proforma_invoice_number_seq did not return a value');
      }
      return `PF-${String(next).padStart(4, '0')}`;
    }

    // SQLite / in-memory development fallback
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS proforma_invoice_number_counter (id INT PRIMARY KEY, next_value INT)`,
    );
    await queryRunner.query(
      `INSERT INTO proforma_invoice_number_counter (id, next_value)
       SELECT 1, 1
       WHERE NOT EXISTS (SELECT 1 FROM proforma_invoice_number_counter WHERE id = 1)`,
    );
    await queryRunner.query(
      `UPDATE proforma_invoice_number_counter SET next_value = next_value + 1 WHERE id = 1`,
    );
    const rows = (await queryRunner.query(
      `SELECT next_value FROM proforma_invoice_number_counter WHERE id = 1`,
    )) as Array<{ next_value: number }>;
    const next = Number(rows?.[0]?.next_value);
    const claimed = Number.isFinite(next) ? next - 1 : 1;
    return `PF-${String(claimed).padStart(4, '0')}`;
  }

  /**
   * Peeks the next proforma number without consuming it.
   */
  async peekNextNumber(): Promise<{ nextNumber: string; preview: true }> {
    if (this.dataSource.options.type === 'postgres') {
      const rows = await this.dataSource.query<Array<{ val: string | number }>>(
        `SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END AS val FROM proforma_invoice_number_seq`,
      );
      const next = Number(rows?.[0]?.val ?? 1);
      return { nextNumber: `PF-${String(next).padStart(4, '0')}`, preview: true };
    }

    await this.dataSource.query(
      `CREATE TABLE IF NOT EXISTS proforma_invoice_number_counter (id INT PRIMARY KEY, next_value INT)`,
    );
    const rows = await this.dataSource.query<Array<{ next_value: number }>>(
      `SELECT next_value FROM proforma_invoice_number_counter WHERE id = 1`,
    );
    const next = Number(rows?.[0]?.next_value ?? 1);
    return { nextNumber: `PF-${String(next).padStart(4, '0')}`, preview: true };
  }

  async create(
    dto: CreateProformaInvoiceDto,
    actor: AuthenticatedUser,
  ): Promise<ProformaInvoice> {
    assertGreenWaveRecyclingFinanceAccess(actor);

    if (dto.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, dto.warehouseId);
    }

    let customerName = dto.customerName ?? null;
    let customerBillTo = dto.billTo ?? null;
    let customerShipTo = dto.shipTo ?? null;

    if (dto.customerId) {
      const customer = await this.customerRepo.findOne({
        where: { id: dto.customerId },
      });
      if (customer) {
        customerName = customerName || customer.name;
        customerBillTo = customerBillTo || customer.billTo;
        customerShipTo = customerShipTo || customer.shipTo;
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const proformaId = randomUUID();

    try {
      const proformaNumber = await this.allocateProformaNumber(queryRunner);

      let subtotal = 0;
      let taxTotal = 0;
      let computedTotalWeight = 0;

      const items: ProformaInvoiceItem[] = dto.items.map((item, idx) => {
        const qty = Number(item.quantity);
        const price = Number(item.unitPrice);
        const discount = Number(item.discount ?? 0);
        const taxRate = Number(item.taxRate ?? 0);
        const weight = item.weight ? Number(item.weight) : 0;

        const lineSubtotal = roundCurrency(qty * price - discount);
        const lineTax = roundCurrency(lineSubtotal * (taxRate / 100));
        const lineTotal = roundCurrency(lineSubtotal + lineTax);

        subtotal = roundCurrency(subtotal + lineSubtotal);
        taxTotal = roundCurrency(taxTotal + lineTax);
        computedTotalWeight += weight;

        const entity = queryRunner.manager.create(ProformaInvoiceItem, {
          id: randomUUID(),
          proformaInvoiceId: proformaId,
          materialId: item.materialId ?? null,
          description: item.description,
          quantity: String(qty),
          unit: item.unit ?? 'kg',
          unitPrice: String(price),
          discount: String(discount),
          taxRate: String(taxRate),
          total: String(lineTotal),
          weight: item.weight ? String(item.weight) : null,
          sortOrder: idx,
        });

        return entity;
      });

      const total = roundCurrency(subtotal + taxTotal);
      const totalWeight = dto.totalWeight !== undefined ? String(dto.totalWeight) : (computedTotalWeight > 0 ? String(computedTotalWeight) : null);

      const proforma = queryRunner.manager.create(ProformaInvoice, {
        id: proformaId,
        proformaNumber,
        customerId: dto.customerId ?? null,
        customerName,
        division: 'recycling',
        warehouseId: dto.warehouseId ?? null,
        issueDate: dto.issueDate,
        validityDate: dto.validityDate ?? null,
        currency: dto.currency || 'CAD',
        poReference: dto.poReference ?? null,
        billTo: customerBillTo,
        shipTo: customerShipTo,
        origin: dto.origin ?? null,
        destination: dto.destination ?? null,
        incoterm: dto.incoterm ?? null,
        incotermLocation: dto.incotermLocation ?? null,
        shippingTerms: dto.shippingTerms ?? null,
        subtotal: String(subtotal),
        taxTotal: String(taxTotal),
        total: String(total),
        totalWeight,
        weightUnit: dto.weightUnit || 'kg',
        notes: dto.notes ?? null,
        commercialTerms: dto.commercialTerms ?? null,
        internalNotes: dto.internalNotes ?? null,
        status: 'draft',
        createdBy: actor.id,
      });

      await queryRunner.manager.save(proforma);
      await queryRunner.manager.save(items);
      await queryRunner.commitTransaction();

      await this.auditService.record({
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'proforma.created',
        entityType: 'proforma_invoice',
        entityId: proformaId,
        warehouseId: dto.warehouseId ?? null,
        summary: `Created proforma invoice ${proformaNumber} ($${total}) for ${customerName || 'customer'}`,
        metadata: { proformaNumber, total, customerId: dto.customerId },
      });

      return this.findOne(proformaId, actor);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(
    actor: AuthenticatedUser,
    query: ListProformasQuery = {},
  ): Promise<ProformaInvoice[]> {
    assertGreenWaveRecyclingFinanceAccess(actor);

    const qb = this.proformaRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.items', 'item')
      .where('p.division = :division', { division: 'recycling' });

    if (!actor.hasGlobalAccess && (!actor.permissions || !actor.permissions.includes('warehouses:global_access'))) {
      const authorizedIds = await this.warehousesService.getUserAuthorizedWarehouseIds(
        actor.id,
        actor.role,
        actor.permissions,
      );
      if (authorizedIds.length === 0) {
        qb.andWhere('p.warehouseId IS NULL');
      } else {
        qb.andWhere('(p.warehouseId IN (:...authorizedIds) OR p.warehouseId IS NULL)', { authorizedIds });
      }
    }

    if (query.status) {
      qb.andWhere('p.status = :status', { status: query.status });
    }
    if (query.warehouseId) {
      qb.andWhere('p.warehouseId = :warehouseId', { warehouseId: query.warehouseId });
    }
    if (query.customerId) {
      qb.andWhere('p.customerId = :customerId', { customerId: query.customerId });
    }
    if (query.search) {
      const s = `%${query.search.toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(p.proformaNumber) LIKE :s OR LOWER(p.customerName) LIKE :s OR LOWER(p.poReference) LIKE :s)',
        { s },
      );
    }

    qb.orderBy('p.createdAt', 'DESC');
    qb.addOrderBy('item.sortOrder', 'ASC');

    return qb.getMany();
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<ProformaInvoice> {
    assertGreenWaveRecyclingFinanceAccess(actor);

    const proforma = await this.proformaRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.items', 'item')
      .where('p.id = :id', { id })
      .orderBy('item.sortOrder', 'ASC')
      .getOne();

    if (!proforma) {
      throw new NotFoundException(`Proforma invoice not found`);
    }

    if (proforma.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(actor, proforma.warehouseId);
    }

    return proforma;
  }

  async update(
    id: string,
    dto: UpdateProformaInvoiceDto,
    actor: AuthenticatedUser,
  ): Promise<ProformaInvoice> {
    assertGreenWaveRecyclingFinanceAccess(actor);

    await this.findOne(id, actor);
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let proforma: ProformaInvoice;
    try {
      const qb = runner.manager.getRepository(ProformaInvoice).createQueryBuilder('p').where('p.id = :id', { id });
      if (this.dataSource.options.type === 'postgres') qb.setLock('pessimistic_write');
      proforma = (await qb.getOne())!;
      if (!proforma) throw new NotFoundException('Proforma not found');
      const itemsRepo = runner.manager.getRepository(ProformaInvoiceItem);

    if (proforma.status === 'converted') {
      throw new BadRequestException('Cannot edit a proforma invoice that has already been converted');
    }
    if (proforma.status === 'cancelled') {
      throw new BadRequestException('Cannot edit a cancelled proforma invoice');
    }

    if (dto.status) {
      proforma.status = dto.status;
    }

    if (dto.issueDate) proforma.issueDate = dto.issueDate;
    if (dto.validityDate !== undefined) proforma.validityDate = dto.validityDate;
    if (dto.currency) proforma.currency = dto.currency;
    if (dto.poReference !== undefined) proforma.poReference = dto.poReference;
    if (dto.billTo !== undefined) proforma.billTo = dto.billTo;
    if (dto.shipTo !== undefined) proforma.shipTo = dto.shipTo;
    if (dto.origin !== undefined) proforma.origin = dto.origin;
    if (dto.destination !== undefined) proforma.destination = dto.destination;
    if (dto.incoterm !== undefined) proforma.incoterm = dto.incoterm;
    if (dto.incotermLocation !== undefined) proforma.incotermLocation = dto.incotermLocation;
    if (dto.shippingTerms !== undefined) proforma.shippingTerms = dto.shippingTerms;
    if (dto.notes !== undefined) proforma.notes = dto.notes;
    if (dto.commercialTerms !== undefined) proforma.commercialTerms = dto.commercialTerms;
    if (dto.internalNotes !== undefined) proforma.internalNotes = dto.internalNotes;
    if (dto.totalWeight !== undefined) proforma.totalWeight = String(dto.totalWeight);
    if (dto.weightUnit !== undefined) proforma.weightUnit = dto.weightUnit;

    if (dto.items && dto.items.length > 0) {
      await itemsRepo.delete({ proformaInvoiceId: proforma.id });

      let subtotal = 0;
      let taxTotal = 0;
      let computedWeight = 0;

      const items = dto.items.map((item, idx) => {
        const qty = Number(item.quantity);
        const price = Number(item.unitPrice);
        const discount = Number(item.discount ?? 0);
        const taxRate = Number(item.taxRate ?? 0);
        const weight = item.weight ? Number(item.weight) : 0;

        const lineSubtotal = roundCurrency(qty * price - discount);
        const lineTax = roundCurrency(lineSubtotal * (taxRate / 100));
        const lineTotal = roundCurrency(lineSubtotal + lineTax);

        subtotal = roundCurrency(subtotal + lineSubtotal);
        taxTotal = roundCurrency(taxTotal + lineTax);
        computedWeight += weight;

        return itemsRepo.create({
          id: randomUUID(),
          proformaInvoiceId: proforma.id,
          materialId: item.materialId ?? null,
          description: item.description,
          quantity: String(qty),
          unit: item.unit ?? 'kg',
          unitPrice: String(price),
          discount: String(discount),
          taxRate: String(taxRate),
          total: String(lineTotal),
          weight: item.weight ? String(item.weight) : null,
          sortOrder: idx,
        });
      });

      proforma.subtotal = String(subtotal);
      proforma.taxTotal = String(taxTotal);
      proforma.total = String(roundCurrency(subtotal + taxTotal));
      if (dto.totalWeight === undefined && computedWeight > 0) {
        proforma.totalWeight = String(computedWeight);
      }

      await itemsRepo.save(items);
    }

    await runner.manager.save(ProformaInvoice, proforma);
    await runner.commitTransaction();
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'proforma.updated',
      entityType: 'proforma_invoice',
      entityId: proforma.id,
      warehouseId: proforma.warehouseId,
      summary: `Updated proforma invoice ${proforma.proformaNumber} (status: ${proforma.status})`,
      metadata: { status: proforma.status, total: proforma.total },
    });

    return this.findOne(id, actor);
  }

  /**
   * Converts a Proforma Invoice into a real final Invoice.
   *
   * Invariants:
   * 1. Strictly GreenWave Recycling division.
   * 2. Proforma status must be convertible (draft, sent, accepted).
   * 3. Prevents double-conversion (throws BadRequestException if already converted).
   * 4. Cannot convert cancelled or expired proforma.
   * 5. Creates a real invoice using InvoicesService.create() with items, customer, warehouse.
   * 6. Marks proforma as 'converted', stamps convertedInvoiceId, convertedAt, convertedBy.
   * 7. Preserves original proforma document.
   */
  async convert(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ proforma: ProformaInvoice; invoice: any }> {
    assertGreenWaveRecyclingFinanceAccess(actor);

    if (!['admin', 'manager'].includes(actor.role)) {
      throw new ForbiddenException('Only administrators and managers may convert proforma invoices');
    }

    await this.findOne(id, actor);
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let proforma: ProformaInvoice;
    let createdInvoice: any;
    try {
      const qb = runner.manager.getRepository(ProformaInvoice).createQueryBuilder('p').where('p.id = :id', { id });
      if (this.dataSource.options.type === 'postgres') qb.setLock('pessimistic_write');
      proforma = (await qb.getOne())!;
      if (!proforma) throw new NotFoundException('Proforma not found');
      proforma.items = await runner.manager.find(ProformaInvoiceItem, { where: { proformaInvoiceId: id }, order: { sortOrder: 'ASC' } });

    if (proforma.status === 'converted') {
      throw new BadRequestException(`Proforma invoice ${proforma.proformaNumber} has already been converted`);
    }
    if (proforma.status === 'cancelled') {
      throw new BadRequestException(`Cannot convert a cancelled proforma invoice`);
    }
    if (proforma.status === 'expired') {
      throw new BadRequestException(`Cannot convert an expired proforma invoice`);
    }

    const taxRates = new Set(proforma.items.map(item => Number(item.taxRate)));
    if (taxRates.size > 1) throw new BadRequestException('Mixed tax rates require review before final invoice conversion');
    const invoiceItems = proforma.items.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      unit: item.unit,
      discount: Number(item.discount),
      isRebate: false,
      productService: 'supply',
      taxRateLabel: 'GST',
    }));

    const notesAppend = proforma.notes
      ? `${proforma.notes}\n[Converted from Proforma ${proforma.proformaNumber}]`
      : `[Converted from Proforma ${proforma.proformaNumber}]`;

    // Real invoice creation: triggers standard numbering sequence and accounting lifecycle
    createdInvoice = await this.invoicesService.create(
      {
        customerId: proforma.customerId || undefined,
        warehouseId: proforma.warehouseId || undefined,
        division: 'recycling',
        invoiceDate: new Date().toISOString().split('T')[0],
        billTo: proforma.billTo || undefined,
        shipTo: proforma.shipTo || undefined,
        poReference: proforma.poReference || undefined,
        currency: proforma.currency || 'CAD',
        notes: notesAppend,
        items: invoiceItems,
        status: 'final',
        taxRate: Number(proforma.items[0]?.taxRate ?? 0),
      },
      actor,
      runner,
    );

    // Update proforma state to converted
    proforma.status = 'converted';
    proforma.convertedInvoiceId = createdInvoice.id;
    proforma.convertedAt = new Date();
    proforma.convertedBy = actor.id;
    await runner.manager.save(ProformaInvoice, proforma);
    await runner.commitTransaction();
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'proforma.converted',
      entityType: 'proforma_invoice',
      entityId: proforma.id,
      warehouseId: proforma.warehouseId,
      summary: `Converted proforma ${proforma.proformaNumber} into final invoice #${createdInvoice.invoiceNumber}`,
      metadata: {
        proformaNumber: proforma.proformaNumber,
        invoiceId: createdInvoice.id,
        invoiceNumber: createdInvoice.invoiceNumber,
      },
    });

    return { proforma, invoice: createdInvoice };
  }

  /**
   * Generates a professional Proforma Invoice HTML string for PDF rendering.
   * Prominently displays PROFORMA INVOICE notice with 0 payment instructions.
   */
  generateProformaHtml(proforma: ProformaInvoice): string {
    const itemsHtml = proforma.items
      .map(
        (item, idx) => `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${idx + 1}</td>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
            <strong>${escapeHtml(item.description)}</strong>
            ${item.weight ? `<br><small style="color: #6b7280;">Est. Weight: ${item.weight} ${item.unit || 'kg'}</small>` : ''}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">${item.quantity} ${escapeHtml(item.unit)}</td>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${Number(item.unitPrice).toFixed(2)}</td>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${Number(item.discount).toFixed(2)}</td>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${Number(item.total).toFixed(2)}</td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Proforma Invoice ${proforma.proformaNumber}</title>
  <style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #111827; margin: 0; padding: 30px; font-size: 13px; line-height: 1.5; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 25px; }
    .brand { font-size: 24px; font-weight: bold; color: #047857; letter-spacing: -0.5px; }
    .doc-title { font-size: 26px; font-weight: 800; color: #1f2937; text-align: right; margin: 0; }
    .badge { display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 4px; background: #fef3c7; color: #92400e; text-transform: uppercase; margin-top: 4px; }
    .banner { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; padding: 10px 14px; border-radius: 6px; font-weight: 600; font-size: 12px; margin-bottom: 25px; text-align: center; }
    .grid { display: flex; justify-content: space-between; margin-bottom: 25px; gap: 20px; }
    .box { flex: 1; background: #f9fafb; border: 1px solid #e5e7eb; padding: 14px; border-radius: 6px; }
    .box h4 { margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
    th { background: #f3f4f6; color: #374151; font-weight: 600; text-align: left; padding: 10px; font-size: 11px; text-transform: uppercase; border-bottom: 2px solid #d1d5db; }
    .totals { display: flex; justify-content: flex-end; margin-bottom: 25px; }
    .totals-table { width: 320px; }
    .totals-table tr td { padding: 6px 10px; }
    .totals-table tr.grand-total td { font-size: 16px; font-weight: 700; color: #047857; border-top: 2px solid #111827; }
    .footer { border-top: 1px solid #e5e7eb; padding-top: 15px; font-size: 11px; color: #6b7280; text-align: center; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">GreenWave Recycling</div>
      <div style="color: #4b5563; font-size: 12px; margin-top: 4px;">
        Commercial Recycling & Waste Recovery Solutions<br>
        Email: sales@greenwaverecycling.ca
      </div>
    </div>
    <div style="text-align: right;">
      <h1 class="doc-title">PROFORMA INVOICE</h1>
      <div style="font-size: 14px; font-weight: 700; color: #374151; margin-top: 4px;">${proforma.proformaNumber}</div>
      <div class="badge">${proforma.status}</div>
    </div>
  </div>

  <div class="banner">
    ⚠️ NOTICE: This is a preliminary proforma estimate for commercial and customs purposes. It is NOT a tax invoice or demand for payment.
  </div>

  <div class="grid">
    <div class="box">
      <h4>Bill To</h4>
      <strong>${escapeHtml(proforma.customerName || 'Customer')}</strong><br>
      ${proforma.billTo ? escapeHtml(proforma.billTo).replace(/\n/g, '<br>') : '—'}
    </div>
    <div class="box">
      <h4>Ship / Delivery To</h4>
      ${proforma.shipTo ? escapeHtml(proforma.shipTo).replace(/\n/g, '<br>') : (proforma.destination ? escapeHtml(proforma.destination) : '—')}
    </div>
    <div class="box">
      <h4>Document Details</h4>
      <strong>Issue Date:</strong> ${proforma.issueDate}<br>
      <strong>Valid Until:</strong> ${proforma.validityDate || 'Open'}<br>
      <strong>PO Reference:</strong> ${proforma.poReference || '—'}<br>
      <strong>Currency:</strong> ${proforma.currency}<br>
      ${proforma.incoterm ? `<strong>Incoterm:</strong> ${escapeHtml(proforma.incoterm)} ${proforma.incotermLocation ? `(${escapeHtml(proforma.incotermLocation)})` : ''}<br>` : ''}
      ${proforma.totalWeight ? `<strong>Est. Total Weight:</strong> ${proforma.totalWeight} ${proforma.weightUnit}<br>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 40px;">#</th>
        <th>Description</th>
        <th style="text-align: right; width: 110px;">Quantity</th>
        <th style="text-align: right; width: 100px;">Unit Price</th>
        <th style="text-align: right; width: 90px;">Discount</th>
        <th style="text-align: right; width: 110px;">Line Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
    </tbody>
  </table>

  <div class="totals">
    <table class="totals-table">
      <tr>
        <td>Subtotal:</td>
        <td style="text-align: right; font-weight: 600;">$${Number(proforma.subtotal).toFixed(2)}</td>
      </tr>
      <tr>
        <td>Estimated Tax / Duties:</td>
        <td style="text-align: right; font-weight: 600;">$${Number(proforma.taxTotal).toFixed(2)}</td>
      </tr>
      <tr class="grand-total">
        <td>Estimated Total (${proforma.currency}):</td>
        <td style="text-align: right;">$${Number(proforma.total).toFixed(2)}</td>
      </tr>
    </table>
  </div>

  ${proforma.commercialTerms || proforma.notes ? `
  <div class="box" style="margin-bottom: 20px;">
    <h4>Commercial Terms & Notes</h4>
    ${proforma.commercialTerms ? `<div><strong>Terms:</strong> ${escapeHtml(proforma.commercialTerms)}</div>` : ''}
    ${proforma.notes ? `<div><strong>Notes:</strong> ${escapeHtml(proforma.notes)}</div>` : ''}
  </div>` : ''}

  <div class="footer">
    GreenWave Recycling • This proforma invoice is valid until the specified date and subject to commercial confirmation.
  </div>
</body>
</html>`;
  }

  /**
   * Renders the Proforma Invoice into a PDF buffer.
   */
  async renderPdf(id: string, actor: AuthenticatedUser): Promise<Buffer> {
    const proforma = await this.findOne(id, actor);
    const html = this.generateProformaHtml(proforma);

    try {
      const { chromium } = require('playwright');
      const browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          displayHeaderFooter: false,
          margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
        });
        return pdfBuffer;
      } finally {
        await browser.close();
      }
    } catch (err) {
      this.logger.warn(`Playwright PDF render fallback: ${err.message}`);
      throw new BadRequestException('PDF rendering unavailable');
    }
  }

  /**
   * Sends the Proforma Invoice via email with PDF attachment.
   * Does NOT contain payment links or trigger billing collection.
   */
  async sendEmail(
    id: string,
    recipientEmail: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<{ sent: boolean; status: string; recipient?: string; note?: string }> {
    assertGreenWaveRecyclingFinanceAccess(actor);

    const proforma = await this.findOne(id, actor);

    let targetEmail = recipientEmail;
    if (!targetEmail && proforma.customerId) {
      const customer = await this.customerRepo.findOne({
        where: { id: proforma.customerId },
      });
      targetEmail = customer?.email || undefined;
    }

    if (!targetEmail) {
      throw new BadRequestException('Recipient email address is required');
    }

    if (!this.mailService) {
      return {
        sent: false,
        status: 'REQUIRES DATABASE/CONFIGURATION',
        recipient: targetEmail,
        note: 'Email transport or database outbox is not configured in this environment.',
      };
    }

    const pdfBuffer = await this.renderPdf(id, actor);

    try {
      const result = await this.mailService.sendOnce({
        dedupeKey: `proforma-email-${proforma.id}-${Date.now()}`,
        template: 'proforma_invoice',
        to: targetEmail,
        subject: `Proforma Invoice ${proforma.proformaNumber} — GreenWave Recycling`,
        text: `Please find attached Proforma Invoice ${proforma.proformaNumber} for your review and approval.\n\nTotal Estimated Value: $${proforma.total} ${proforma.currency}\n\nNote: This is a preliminary commercial estimate and is not a demand for payment.`,
        html: `<p>Dear Customer,</p><p>Please find attached Proforma Invoice <strong>${proforma.proformaNumber}</strong> for your review and approval.</p><p><strong>Estimated Total:</strong> $${proforma.total} ${proforma.currency}</p><p><em>Notice: This is a preliminary commercial document and is not a demand for payment.</em></p><p>Best regards,<br>GreenWave Recycling Team</p>`,
        attachments: [
          {
            filename: `${proforma.proformaNumber}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
        entityType: 'proforma_invoice',
        entityId: proforma.id,
      });

      if (result.status === 'SENT' || result.status === 'SKIPPED') {
        if (proforma.status === 'draft') {
          await this.proformaRepo.update({ id: proforma.id, status: 'draft' }, { status: 'sent' });
        }
      }

      return {
        sent: result.status === 'SENT',
        status: result.status,
        recipient: targetEmail,
      };
    } catch (err) {
      this.logger.error(`Failed to send proforma email: ${err.message}`);
      return {
        sent: false,
        status: 'REQUIRES DATABASE/CONFIGURATION',
        recipient: targetEmail,
        note: err.message,
      };
    }
  }
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
