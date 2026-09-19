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
   * Proforma Invoice document HTML (A4, rendered by Chromium in renderPdf()).
   *
   * Deliberately unlike a payable invoice: no due date, no payment status,
   * no payment instructions or links, and the non-payment / non-tax-invoice
   * statement sits directly under the title. Multi-page output repeats the
   * table header, never splits a line item across pages, and keeps the
   * totals and terms blocks whole. Page numbers come from the PDF footer.
   */
  generateProformaHtml(proforma: ProformaInvoice): string {
    const cur = proforma.currency || 'CAD';
    const wUnit = proforma.weightUnit || 'kg';
    const fmt = (n: unknown, min: number, max: number) =>
      Number(n ?? 0).toLocaleString('en-CA', { minimumFractionDigits: min, maximumFractionDigits: max });
    const money = (n: unknown) => fmt(n, 2, 2);
    // Unit prices keep up to 4 decimals (per-kg pricing), so qty x price
    // visibly reproduces the line total.
    const price = (n: unknown) => fmt(n, 2, 4);
    const qty = (n: unknown) => fmt(n, 0, 3);
    const text = (v: string | null | undefined) => escapeHtml(v || '');
    const multi = (v: string | null | undefined) => text(v).replace(/\r?\n/g, '<br>');

    const items = proforma.items || [];
    const hasDiscount = items.some((i) => Number(i.discount) > 0);
    const hasTax = items.some((i) => Number(i.taxRate) > 0);
    const hasWeight = items.some((i) => Number(i.weight) > 0);
    const totalWeight = Number(proforma.totalWeight) || 0;

    const rows = items
      .map((item, idx) => {
        const lineSub = Number(item.quantity) * Number(item.unitPrice) - Number(item.discount || 0);
        return `
        <tr>
          <td class="c-n">${idx + 1}</td>
          <td class="c-desc">${text(item.description)}</td>
          <td class="r">${qty(item.quantity)}&nbsp;${text(item.unit)}</td>
          <td class="r">${price(item.unitPrice)}</td>
          ${hasDiscount ? `<td class="r">${Number(item.discount) > 0 ? '−' + money(item.discount) : '—'}</td>` : ''}
          ${hasTax ? `<td class="r">${fmt(item.taxRate, 0, 3)}%</td>` : ''}
          ${hasWeight ? `<td class="r">${Number(item.weight) > 0 ? qty(item.weight) + '&nbsp;' + text(wUnit) : '—'}</td>` : ''}
          <td class="r strong">${money(Math.round(lineSub * 100) / 100)}</td>
        </tr>`;
      })
      .join('');

    const statusNote: Record<string, string> = {
      draft: 'Draft',
      expired: 'Expired',
      cancelled: 'Cancelled',
      converted: 'Converted to invoice',
    };
    const status = statusNote[proforma.status] ? `<div class="status">${statusNote[proforma.status]}</div>` : '';

    const detail = (label: string, value: string) =>
      value ? `<div class="kv"><span>${label}</span><strong>${value}</strong></div>` : '';

    const incoterm = proforma.incoterm
      ? text(proforma.incoterm) + (proforma.incotermLocation ? ' ' + text(proforma.incotermLocation) : '')
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Proforma Invoice ${text(proforma.proformaNumber)}</title>
  <style>
    @page { size: A4; margin: 14mm 14mm 18mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #111827; margin: 0; font-size: 9.5pt; line-height: 1.4; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 12px; border-bottom: 2px solid #065f46; }
    .brand { font-size: 17pt; font-weight: 700; color: #065f46; letter-spacing: -0.2px; }
    .seller { color: #374151; font-size: 8.5pt; margin-top: 4px; line-height: 1.45; }
    .title { text-align: right; }
    .title h1 { font-size: 20pt; letter-spacing: 1.5px; margin: 0; color: #111827; font-weight: 800; }
    .title .no { font-size: 12pt; font-weight: 700; margin-top: 2px; font-family: 'Courier New', monospace; }
    .status { display: inline-block; margin-top: 6px; padding: 2px 8px; border: 1px solid #9ca3af; border-radius: 3px; font-size: 7.5pt; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; color: #374151; }
    .disclaimer { margin: 10px 0 14px; padding: 7px 10px; border: 1px solid #111827; border-left-width: 4px; font-weight: 700; font-size: 9pt; }
    .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
    .box { border: 1px solid #d1d5db; border-radius: 4px; padding: 8px 10px; break-inside: avoid; overflow-wrap: anywhere; }
    .box h4 { margin: 0 0 5px; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .6px; color: #6b7280; }
    .box .name { font-weight: 700; }
    .kv { display: flex; justify-content: space-between; gap: 10px; padding: 1.5px 0; }
    .kv span { color: #6b7280; white-space: nowrap; }
    .kv strong { text-align: right; font-weight: 600; overflow-wrap: anywhere; }
    table.items { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    table.items thead { display: table-header-group; }
    table.items th { background: #f3f4f6; color: #374151; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .4px; text-align: left; padding: 6px 6px; border-bottom: 1.5px solid #6b7280; white-space: nowrap; }
    table.items td { padding: 6px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    table.items tr { break-inside: avoid; page-break-inside: avoid; }
    .r { text-align: right !important; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .strong { font-weight: 700; }
    .c-n { width: 22px; color: #6b7280; }
    .c-desc { overflow-wrap: anywhere; }
    .cur-note { font-size: 7.5pt; color: #6b7280; margin: -4px 0 10px; text-align: right; }
    .end { display: flex; gap: 14px; align-items: flex-start; break-inside: avoid; page-break-inside: avoid; }
    .end .terms { flex: 1; }
    .totals { width: 275px; border: 1px solid #111827; border-radius: 4px; padding: 8px 10px; break-inside: avoid; }
    .totals .kv { padding: 3px 0; }
    .totals .grand { border-top: 1.5px solid #111827; margin-top: 4px; padding-top: 6px; font-size: 11pt; }
    .totals .grand span { color: #111827; font-weight: 700; white-space: normal; }
    .totals .kv strong { white-space: nowrap; }
    .terms .box + .box { margin-top: 8px; }
    .pre { white-space: normal; }
  </style>
</head>
<body>
  <div class="top">
    <div>
      <div class="brand">GreenWave Recycling Inc.</div>
      <div class="seller">23394, Fisherman Rd<br>Maple Ridge, BC, V3W 1B9, CANADA<br>1-672-472-0423 · sales@greenwaverecycling.ca</div>
    </div>
    <div class="title">
      <h1>PROFORMA INVOICE</h1>
      <div class="no">${text(proforma.proformaNumber)}</div>
      ${status}
    </div>
  </div>

  <div class="disclaimer">This is a proforma invoice and is not a demand for payment or a tax invoice.</div>

  <div class="grid">
    <div class="box">
      <h4>Bill to</h4>
      <div class="name">${text(proforma.customerName) || '—'}</div>
      ${proforma.billTo ? `<div class="pre">${multi(proforma.billTo)}</div>` : ''}
    </div>
    <div class="box">
      <h4>Ship to</h4>
      ${proforma.shipTo ? `<div class="pre">${multi(proforma.shipTo)}</div>` : (proforma.destination ? text(proforma.destination) : '—')}
    </div>
    <div class="box">
      <h4>Document</h4>
      ${detail('Issue date', text(proforma.issueDate))}
      ${detail('Valid until', text(proforma.validityDate) || 'Open')}
      ${detail('Customer ref.', text(proforma.poReference))}
      ${detail('Currency', text(cur))}
    </div>
  </div>

  <div class="grid2">
    <div class="box">
      <h4>Shipment</h4>
      ${detail('Origin', text(proforma.origin)) || '<div class="kv"><span>Origin</span><strong>—</strong></div>'}
      ${detail('Destination', text(proforma.destination)) || '<div class="kv"><span>Destination</span><strong>—</strong></div>'}
      ${detail('Incoterm', incoterm)}
      ${detail('Est. total weight', totalWeight > 0 ? qty(totalWeight) + ' ' + text(wUnit) : '')}
    </div>
    <div class="box">
      <h4>Shipping terms</h4>
      <div class="pre">${multi(proforma.shippingTerms) || '—'}</div>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>#</th>
        <th>Description</th>
        <th class="r">Quantity</th>
        <th class="r">Unit price</th>
        ${hasDiscount ? '<th class="r">Discount</th>' : ''}
        ${hasTax ? '<th class="r">Tax</th>' : ''}
        ${hasWeight ? '<th class="r">Weight</th>' : ''}
        <th class="r">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="cur-note">All amounts in ${text(cur)}${hasTax ? '. Line amounts exclude tax; estimated tax is added in the totals' : ''}.</div>

  <div class="end">
    <div class="terms">
      ${proforma.notes ? `<div class="box"><h4>Notes</h4><div class="pre">${multi(proforma.notes)}</div></div>` : ''}
      ${proforma.commercialTerms ? `<div class="box"><h4>Commercial terms</h4><div class="pre">${multi(proforma.commercialTerms)}</div></div>` : ''}
    </div>
    <div class="totals">
      ${totalWeight > 0 ? `<div class="kv"><span>Total weight</span><strong>${qty(totalWeight)} ${text(wUnit)}</strong></div>` : ''}
      <div class="kv"><span>Subtotal</span><strong>${money(proforma.subtotal)}</strong></div>
      <div class="kv"><span>Estimated tax</span><strong>${money(proforma.taxTotal)}</strong></div>
      <div class="kv grand"><span>Estimated total (${text(cur)})</span><strong>${money(proforma.total)}</strong></div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Renders the Proforma Invoice into a PDF buffer. Page size and margins
   * come from the template's @page rule; the footer (document number,
   * non-payment statement, page x of y) is the only header/footer printed.
   */
  async renderPdf(id: string, actor: AuthenticatedUser): Promise<Buffer> {
    const proforma = await this.findOne(id, actor);
    const html = this.generateProformaHtml(proforma);
    const footer = `<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7.5px;color:#6b7280;padding:0 14mm;display:flex;justify-content:space-between;">
      <span>GreenWave Recycling Inc. · Proforma ${escapeHtml(proforma.proformaNumber)} · Not a demand for payment or a tax invoice</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

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
          preferCSSPageSize: true,
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate: footer,
          margin: { top: '14mm', right: '14mm', bottom: '18mm', left: '14mm' },
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

      // Only a message the mail subsystem actually dispatched moves a draft to
      // `sent`. SKIPPED (no SMTP configured), FAILED (transport error) and
      // DUPLICATE leave the proforma's status exactly as it was.
      const sent = result.status === 'SENT';
      if (sent && proforma.status === 'draft') {
        await this.proformaRepo.update(
          { id: proforma.id, status: 'draft' },
          { status: 'sent' },
        );
      }

      return {
        sent,
        status: result.status,
        recipient: targetEmail,
        ...('reason' in result ? { note: result.reason } : {}),
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
