import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, QueryRunner, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { roundCurrency } from '../common/rounding';
import { Customer } from '../customers/entities/customer.entity';
import {
  DIVISION_GREENWAVE,
  normalizeDivision,
} from '../divisions/divisions.constants';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { DivisionsService } from '../divisions/divisions.service';
import { Payment } from '../payments/entities/payment.entity';
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

/**
 * First invoice number issued by a fresh install. Kept in sync with the
 * START WITH / floor value in migration 016_invoice_number_sequence.sql.
 */
export const INVOICE_NUMBER_START = 10000;

/**
 * Guards the legacy `invoice_number_counter` path.
 *
 * Production always runs on PostgreSQL (`type: 'postgres'` is hardcoded in
 * AppModule), so the counter branch below exists purely for the SQLite-backed
 * integration specs. Making that explicit means a future misconfiguration
 * fails fast instead of quietly issuing numbers from the deprecated counter --
 * which is precisely how the pre-016 `1115 + COUNT(*)` fallback went unnoticed.
 */
function assertLegacyCounterAllowed(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Invoice numbering requires PostgreSQL: refusing to allocate from the ' +
        'deprecated invoice_number_counter in production. Expected the ' +
        'datasource to be postgres so nextval(invoice_number_seq) is used.',
    );
  }
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
    private readonly divisionsService: DivisionsService,
    private readonly postingService: AccountingPostingService,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
  ) {}

  /**
   * Allocates the next invoice number.
   *
   * On PostgreSQL this is a bare `nextval()` on `invoice_number_seq` (see
   * migration 016). `nextval` is atomic and deliberately NOT transactional:
   * two concurrent creates can never receive the same number, and a number
   * that was handed out is never reissued -- including when the invoice that
   * received it is later deleted. It is intentionally NOT run on the caller's
   * queryRunner-bound transaction semantics for rollback purposes; a rolled
   * back create simply burns a number, which is the correct trade-off for an
   * invoice series (gaps are acceptable, duplicates are not).
   *
   * Non-PostgreSQL drivers (better-sqlite3, used by the integration specs)
   * have no sequences, so they fall back to an atomic increment of the
   * legacy single-row `invoice_number_counter` table. SQLite serialises
   * writers, so the increment-then-read is safe there.
   */
  private async allocateInvoiceNumber(
    queryRunner: QueryRunner,
  ): Promise<string> {
    if (this.dataSource.options.type === 'postgres') {
      const rows = (await queryRunner.query(
        `SELECT nextval('invoice_number_seq') AS value`,
      )) as Array<{ value: string | number }>;
      const value = rows?.[0]?.value;
      if (value === undefined || value === null) {
        throw new Error('invoice_number_seq did not return a value');
      }
      // pg returns bigint as a string to avoid precision loss; keep it as-is
      // so the stored invoice_number matches the sequence exactly.
      return String(value);
    }

    assertLegacyCounterAllowed();

    await queryRunner.query(
      `INSERT INTO invoice_number_counter (id, next_value)
       SELECT 1, ${INVOICE_NUMBER_START}
       WHERE NOT EXISTS (SELECT 1 FROM invoice_number_counter WHERE id = 1)`,
    );
    await queryRunner.query(
      `UPDATE invoice_number_counter SET next_value = next_value + 1 WHERE id = 1`,
    );
    const rows = (await queryRunner.query(
      `SELECT next_value FROM invoice_number_counter WHERE id = 1`,
    )) as Array<{ next_value: number }>;
    const next = Number(rows?.[0]?.next_value);
    if (!Number.isFinite(next)) {
      throw new Error('invoice_number_counter did not return a value');
    }
    // The row holds the *next* value to issue, so the number we just claimed
    // is one below what the incremented row now reads.
    return String(next - 1);
  }

  /**
   * Returns the number the *next* invoice would receive, WITHOUT consuming it.
   *
   * This exists so the editor can show "10000 (Assigned)" while composing a
   * new invoice instead of a hardcoded guess -- the backend stays the single
   * source of truth for numbering. It is explicitly a preview, not a
   * reservation: if another user saves first, they take this number and the
   * next save gets the one after. The authoritative number is the one
   * returned by create().
   */
  async peekNextInvoiceNumber(): Promise<{
    nextNumber: string;
    preview: true;
  }> {
    if (this.dataSource.options.type === 'postgres') {
      const rows = await this.dataSource.query<
        Array<{ value: string | number }>
      >(
        `SELECT GREATEST(
                  $1::BIGINT,
                  COALESCE(pg_sequence_last_value('invoice_number_seq') + 1, $1::BIGINT)
                ) AS value`,
        [INVOICE_NUMBER_START],
      );
      return {
        nextNumber: String(rows?.[0]?.value ?? INVOICE_NUMBER_START),
        preview: true,
      };
    }

    assertLegacyCounterAllowed();

    const rows = await this.dataSource.query<Array<{ next_value: number }>>(
      `SELECT next_value FROM invoice_number_counter WHERE id = 1`,
    );
    const next = Number(rows?.[0]?.next_value);
    return {
      nextNumber: String(Number.isFinite(next) ? next : INVOICE_NUMBER_START),
      preview: true,
    };
  }

  async create(
    dto: CreateInvoiceDto,
    actor: AuthenticatedUser,
    existingRunner?: QueryRunner,
  ): Promise<Invoice> {
    if (dto.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        dto.warehouseId,
      );
    }

    // Resolve and authorize the division *before* opening the transaction, so
    // a rejected request never reaches allocateInvoiceNumber and therefore
    // never burns a number from the sequence.
    const division = await this.resolveCreateDivision(actor, dto.division);
    const divisionStorage = this.divisionsService.storageValueFor(division);
    await this.assertCustomerInDivision(dto.customerId, divisionStorage);
    if (dto.status === 'paid') {
      throw new BadRequestException(
        'An invoice becomes paid only through a recorded payment',
      );
    }

    const queryRunner = existingRunner ?? this.dataSource.createQueryRunner();
    if (!existingRunner) {
      await queryRunner.connect();
      await queryRunner.startTransaction();
    }

    // Declared outside the try so the post-commit audit/re-read below can
    // still see them once the connection has been released.
    const invoiceId = randomUUID();
    let invoiceNumber: string;
    let totals: ReturnType<typeof computeTotals>;

    try {
      invoiceNumber = await this.allocateInvoiceNumber(queryRunner);
      totals = computeTotals(invoiceId, dto.items, dto.taxRate ?? 0);

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
        // Server-owned. Payment links are created on demand (hashed); no
        // plaintext token is stored.
        paymentStatus: 'unpaid',
        paymentToken: null,
        paidAt: null,
        paymentProvider: null,
        paymentReference: null,
        warehouseId: dto.warehouseId ?? null,
        division: divisionStorage,
        createdBy: actor.id,
        updatedBy: actor.id,
      });

      await queryRunner.manager.save(Invoice, invoice);
      await queryRunner.manager.save(InvoiceItem, totals.items);
      // An invoice created directly as final is a receivable immediately.
      await this.postingService.syncInvoiceIssued(
        invoice,
        { actorId: actor.id },
        queryRunner.manager,
      );
      if (existingRunner) {
        invoice.items = totals.items;
        return invoice;
      }
      await queryRunner.commitTransaction();
    } catch (err) {
      // Only roll back a transaction that is still open. A failure raised
      // after commitTransaction() would otherwise be masked by the
      // "transaction not started" error thrown from here.
      if (!existingRunner && queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw err;
    } finally {
      if (!existingRunner) await queryRunner.release();
    }

    // IMPORTANT: everything below runs *after* the query runner has returned
    // its connection to the pool. Both the audit write and the re-read need a
    // connection of their own, and the pool defaults to 10. Doing them while
    // still holding the runner's connection meant that under concurrent
    // invoice creation every pooled connection was held by a request waiting
    // for a connection that could never be freed -- the API deadlocked and
    // stopped serving *all* authenticated endpoints until restarted.
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
  }

  async duplicate(id: string, actor: AuthenticatedUser): Promise<Invoice> {
    const source = await this.findOneInternal(id);
    await this.divisionsService.assertStoredDivisionAccess(
      actor,
      source.division,
    );
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
      // The copy stays in the source's division. Without it, create() cannot
      // infer a division for a multi-division actor and rejects with 400.
      division: source.division,
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

    // Must hold the invoice's current division, and the target one if it is
    // being moved. Re-pointing the invoice at a customer is checked against
    // the division the invoice will end up in, closing the
    // invoice -> customer cross-division read.
    await this.divisionsService.assertStoredDivisionAccess(
      actor,
      existing.division,
    );
    let divisionStorage = existing.division;
    if (dto.division !== undefined) {
      const target = await this.divisionsService.assertDivisionAccess(
        actor,
        dto.division,
      );
      if (target)
        divisionStorage = this.divisionsService.storageValueFor(target);
    }
    if (dto.customerId !== undefined) {
      await this.assertCustomerInDivision(dto.customerId, divisionStorage);
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
    const nextStatus = this.assertAllowedUpdate(existing, dto, totals.total, await this.financialLock(id));

    await this.dataSource.transaction(async (m: EntityManager) => {
    await m.getRepository(InvoiceItem).delete({ invoiceId: id });
    await m.getRepository(InvoiceItem).save(totals.items);

    await m.getRepository(Invoice).update(id, {
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
      status: nextStatus,
      currency: dto.currency ?? existing.currency,
      // paymentStatus is server-owned; any client value is ignored.
      warehouseId: dto.warehouseId ?? existing.warehouseId,
      division: divisionStorage,
      updatedBy: actor.id,
      ...(nextStatus === 'void' && existing.status !== 'void'
        ? { paymentLinkRevokedAt: new Date() }
        : {}),
    });

    // Keep AR/revenue in step with the saved invoice (issue, re-issue on an
    // amount change, or reverse on draft/void). Same transaction.
    const saved = await m.getRepository(Invoice).findOne({ where: { id } });
    if (saved) {
      await this.postingService.syncInvoiceIssued(saved, { actorId: actor.id }, m);
    }
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
      division?: string;
    },
  ) {
    if (filters.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        filters.warehouseId,
      );
    }

    const divisionValues =
      await this.divisionsService.scopeDivisionStorageValues(
        actor,
        filters.division,
      );
    if (divisionValues.length === 0) return [];

    const qb = this.invoiceRepository
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.items', 'items')
      .andWhere('inv.division IN (:...divisionValues)', { divisionValues })
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

  /** Payments that freeze an invoice's amounts: any open or settled attempt. */
  private financialLock(invoiceId: string): Promise<number> {
    return this.paymentRepository.count({
      where: {
        invoiceId,
        status: In([
          'CREATED',
          'REQUIRES_ACTION',
          'PROCESSING',
          'SUCCEEDED',
          'PARTIALLY_REFUNDED',
          'REFUNDED',
          'DISPUTED',
        ]),
      },
    });
  }

  /**
   * Server-side rules for editing an invoice that may already be a receivable
   * or have money against it. Returns the status to persist.
   */
  private assertAllowedUpdate(
    existing: Invoice,
    dto: UpdateInvoiceDto,
    newTotal: number,
    paymentsAgainstInvoice: number,
  ): string {
    const current = (existing.status || 'draft').toLowerCase();
    const requested = dto.status?.toLowerCase();
    const paid = ['paid', 'refunded', 'partially_refunded', 'disputed'].includes(
      (existing.paymentStatus || '').toLowerCase(),
    );

    if (requested === 'paid' && current !== 'paid') {
      throw new BadRequestException(
        'An invoice becomes paid only through a recorded payment',
      );
    }
    if (current === 'void' && requested && requested !== 'void') {
      throw new ConflictException('A void invoice cannot be reopened; duplicate it instead');
    }

    const amountChanged =
      Math.round(Number(existing.total) * 100) !== Math.round(newTotal * 100) ||
      (dto.currency !== undefined && dto.currency !== existing.currency);
    if (amountChanged && (paid || paymentsAgainstInvoice > 0)) {
      throw new ConflictException(
        'This invoice has a payment in progress or completed; its amount and currency cannot be changed',
      );
    }
    if ((requested === 'void' || requested === 'draft') && requested !== current && (paid || paymentsAgainstInvoice > 0)) {
      throw new ConflictException(
        `An invoice with a payment cannot be moved to ${requested}; refund the payment first`,
      );
    }
    if (current === 'paid') return 'paid';
    return requested ?? current;
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<Invoice> {
    const invoice = await this.findOneInternal(id);
    if (invoice.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        invoice.warehouseId,
      );
    }
    await this.divisionsService.assertStoredDivisionAccess(
      actor,
      invoice.division,
    );
    return invoice;
  }

  /**
   * A customer may only be billed by an invoice in the same division. Without
   * this an authorized GreenWave user could attach a Healthcare customer to a
   * GreenWave invoice and read that customer's billing details back out of
   * the invoice payload.
   */
  private async assertCustomerInDivision(
    customerId: string | null | undefined,
    divisionStorage: string,
  ): Promise<void> {
    if (!customerId) return;
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const customerDivision =
      normalizeDivision(customer.division) ?? DIVISION_GREENWAVE;
    const invoiceDivision =
      normalizeDivision(divisionStorage) ?? DIVISION_GREENWAVE;

    if (customerDivision !== invoiceDivision) {
      throw new ForbiddenException(
        'This customer belongs to a different business division',
      );
    }
  }

  private async resolveCreateDivision(
    actor: AuthenticatedUser,
    requested?: string,
  ) {
    if (requested !== undefined && requested !== null && requested !== '') {
      return (await this.divisionsService.assertDivisionAccess(
        actor,
        requested,
      ))!;
    }

    const held = await this.divisionsService.scopeDivisions(actor);
    if (held.length === 1) return held[0];
    if (held.length === 0) {
      throw new ForbiddenException(
        'You are not authorized to access any business division',
      );
    }
    throw new BadRequestException(
      'division is required: your account has access to more than one business division',
    );
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

  /**
   * Generates a clean vector A4 PDF using Playwright Chromium.
   * Enforces exact A4 portrait dimensions, zero browser headers/footers,
   * embedded logo and CSS, and selectable text.
   */
  async generatePdf(docHtml: string): Promise<Buffer> {
    const fs = require('fs');
    const path = require('path');

    // 1. Resolve and embed logo
    let logoDataUri = '';
    const logoCandidates = [
      path.resolve(process.cwd(), '../../assets/logo-invoice.png'),
      path.resolve(process.cwd(), 'assets/logo-invoice.png'),
      '/home/ansh/Greenwaveapp/assets/logo-invoice.png',
      '/var/www/greenwave-app/dist/assets/logo-invoice.png',
      path.resolve(process.cwd(), '../../assets/logo.png'),
      path.resolve(process.cwd(), 'assets/logo.png'),
      '/home/ansh/Greenwaveapp/assets/logo.png',
      '/var/www/greenwave-app/dist/assets/logo.png',
    ];
    for (const p of logoCandidates) {
      try {
        if (fs.existsSync(p)) {
          const buf = fs.readFileSync(p);
          logoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
          break;
        }
      } catch (e) { /* ignore */ }
    }

    let processedHtml = docHtml;
    if (logoDataUri) {
      processedHtml = processedHtml.replace(
        /src=["']assets\/logo(?:-invoice)?\.png[^"']*["']/g,
        `src="${logoDataUri}"`,
      );
    }

    // 2. Resolve and embed payment icons
    const payIcons = ['visa', 'mc', 'discover', 'amex', 'jcb', 'bank'];
    for (const icon of payIcons) {
      const iconCandidates = [
        path.resolve(process.cwd(), `../../assets/pay-${icon}.png`),
        path.resolve(process.cwd(), `assets/pay-${icon}.png`),
        `/home/ansh/Greenwaveapp/assets/pay-${icon}.png`,
        `/var/www/greenwave-app/dist/assets/pay-${icon}.png`,
      ];
      for (const p of iconCandidates) {
        try {
          if (fs.existsSync(p)) {
            const buf = fs.readFileSync(p);
            const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
            const re = new RegExp(`src=["']assets/pay-${icon}\\.png[^"']*["']`, 'g');
            processedHtml = processedHtml.replace(re, `src="${dataUri}"`);
            break;
          }
        } catch (e) { /* ignore */ }
      }
    }

    // 3. Resolve stylesheet
    let appCss = '';
    const cssCandidates = [
      path.resolve(process.cwd(), '../../assets/app.css'),
      path.resolve(process.cwd(), 'assets/app.css'),
      '/home/ansh/Greenwaveapp/assets/app.css',
      '/var/www/greenwave-app/dist/assets/app.css',
    ];
    for (const p of cssCandidates) {
      try {
        if (fs.existsSync(p)) {
          appCss = fs.readFileSync(p, 'utf8');
          break;
        }
      } catch (e) { /* ignore */ }
    }

    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>INVOICE</title>
  <style>
    ${appCss}
    @page {
      size: A4 portrait;
      margin: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .invoice-page-1114 {
      width: 210mm !important;
      min-height: 297mm !important;
      box-sizing: border-box !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      padding: 12mm 14mm !important;
      background: #ffffff !important;
    }
    .inv-1114-table thead, .inv-table thead {
      display: table-header-group;
    }
    .inv-1114-table tr, .inv-table tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .inv-1114-header, .inv-header,
    .inv-1114-banner, .inv-tint-box,
    .inv-1114-meta-grid,
    .inv-1114-bottom-grid, .inv-bottom-area {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  ${processedHtml}
</body>
</html>`;

    const { chromium } = require('playwright');
    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(fullHtml, { waitUntil: 'load' });
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
  }
}
