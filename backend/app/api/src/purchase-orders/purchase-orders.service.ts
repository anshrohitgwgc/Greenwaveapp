import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, QueryRunner, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  centsToMoneyString,
  lineAmountCents,
  sumCents,
} from '../common/decimal';
import {
  DIVISION_GREENWAVE,
  normalizeDivision,
} from '../divisions/divisions.constants';
import { DivisionsService } from '../divisions/divisions.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { PurchaseOrderItemDto } from './dto/purchase-order-item.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';

/**
 * First number issued by a fresh install, matching START WITH in migration
 * 018_purchase_orders.sql. Rendered PO-0001.
 */
export const PURCHASE_ORDER_NUMBER_START = 1;

/** Minimum digits in the rendered number; widens naturally past PO-9999. */
export const PURCHASE_ORDER_NUMBER_PAD = 4;

export const PURCHASE_ORDER_NUMBER_PREFIX = 'PO-';

/**
 * Renders a raw sequence value as the document number the user sees.
 * 1 -> "PO-0001", 42 -> "PO-0042", 12345 -> "PO-12345".
 */
export function formatPurchaseOrderNumber(sequence: string | number): string {
  const digits = String(sequence).replace(/[^0-9]/g, '');
  return (
    PURCHASE_ORDER_NUMBER_PREFIX +
    digits.padStart(PURCHASE_ORDER_NUMBER_PAD, '0')
  );
}

export interface ComputedPurchaseOrderTotals {
  items: PurchaseOrderItem[];
  total: string;
}

/**
 * Builds the line entities and the order total from the submitted items.
 *
 * Every amount is derived here — the DTO has no `amount` or `total` field at
 * all, so a client that computed its own figures (or tampered with them) has
 * nothing to send. Arithmetic is exact fixed-point, not floating point; see
 * src/common/decimal.ts for why that matters on weight x price lines.
 */
export function computePurchaseOrderTotals(
  purchaseOrderId: string,
  items: PurchaseOrderItemDto[],
): ComputedPurchaseOrderTotals {
  const cents: bigint[] = [];

  const builtItems = items.map((item, index) => {
    const amountCents = lineAmountCents(item.quantity, item.unitPrice);
    cents.push(amountCents);

    const entity = new PurchaseOrderItem();
    entity.id = randomUUID();
    entity.purchaseOrderId = purchaseOrderId;
    entity.code = item.code ?? null;
    entity.resin = item.resin ?? null;
    entity.description = item.description;
    entity.color = item.color ?? null;
    entity.quantity = String(item.quantity);
    entity.unit = item.unit ?? null;
    entity.unitPrice = String(item.unitPrice);
    entity.amount = centsToMoneyString(amountCents);
    entity.sortOrder = index;
    return entity;
  });

  return {
    items: builtItems,
    total: centsToMoneyString(sumCents(cents)),
  };
}

/**
 * Guards the SQLite-only counter path.
 *
 * Production runs on PostgreSQL (`type: 'postgres'` is hardcoded in
 * AppModule), so the counter branch exists purely for the in-memory specs.
 * Failing loudly here means a future misconfiguration cannot quietly start
 * issuing PO numbers from a non-atomic counter — which is exactly the class of
 * bug the sequence exists to prevent.
 */
function assertCounterFallbackAllowed(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Purchase order numbering requires PostgreSQL: refusing to allocate ' +
        'from the sqlite purchase_order_number_counter in production. ' +
        'Expected the datasource to be postgres so ' +
        'nextval(purchase_order_number_seq) is used.',
    );
  }
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @InjectRepository(PurchaseOrder)
    private readonly purchaseOrderRepository: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseOrderItem)
    private readonly purchaseOrderItemRepository: Repository<PurchaseOrderItem>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly warehousesService: WarehousesService,
    private readonly divisionsService: DivisionsService,
  ) {}

  /**
   * Allocates the next PO sequence value.
   *
   * On PostgreSQL this is a bare `nextval()` on `purchase_order_number_seq`
   * (migration 018). `nextval` is atomic and deliberately NOT transactional:
   * two concurrent creates can never receive the same number, and a number
   * that has been handed out is never reissued — including when the purchase
   * order that received it is later deleted. A rolled-back create simply burns
   * a number, which is the correct trade-off for a document series: gaps are
   * acceptable, duplicates are not.
   *
   * Non-PostgreSQL drivers (better-sqlite3, used by the specs) have no
   * sequences, so they fall back to an atomic increment of a single-row
   * counter table. SQLite serialises writers, so increment-then-read is safe
   * there.
   */
  private async allocateSequenceNumber(
    queryRunner: QueryRunner,
  ): Promise<string> {
    if (this.dataSource.options.type === 'postgres') {
      const rows = (await queryRunner.query(
        `SELECT nextval('purchase_order_number_seq') AS value`,
      )) as Array<{ value: string | number }>;
      const value = rows?.[0]?.value;
      if (value === undefined || value === null) {
        throw new Error('purchase_order_number_seq did not return a value');
      }
      // pg returns bigint as a string to avoid precision loss; keep it as-is.
      return String(value);
    }

    assertCounterFallbackAllowed();

    await queryRunner.query(
      `INSERT INTO purchase_order_number_counter (id, next_value)
       SELECT 1, ${PURCHASE_ORDER_NUMBER_START}
       WHERE NOT EXISTS (SELECT 1 FROM purchase_order_number_counter WHERE id = 1)`,
    );
    await queryRunner.query(
      `UPDATE purchase_order_number_counter SET next_value = next_value + 1 WHERE id = 1`,
    );
    const rows = (await queryRunner.query(
      `SELECT next_value FROM purchase_order_number_counter WHERE id = 1`,
    )) as Array<{ next_value: number }>;
    const next = Number(rows?.[0]?.next_value);
    if (!Number.isFinite(next)) {
      throw new Error('purchase_order_number_counter did not return a value');
    }
    // The row holds the *next* value to issue, so the number just claimed is
    // one below what the incremented row now reads.
    return String(next - 1);
  }

  /**
   * The number the *next* purchase order would receive, WITHOUT consuming it.
   *
   * Exists so the editor can show "PO-0001" while composing rather than a
   * hardcoded guess — the backend stays the single source of truth. It is
   * explicitly a preview, not a reservation: if another admin saves first they
   * take this number and the next save gets the one after. The authoritative
   * number is the one returned by create().
   */
  async peekNextPurchaseOrderNumber(): Promise<{
    nextNumber: string;
    nextSequence: string;
    preview: true;
  }> {
    let sequence = PURCHASE_ORDER_NUMBER_START;

    if (this.dataSource.options.type === 'postgres') {
      const rows = await this.dataSource.query<
        Array<{ value: string | number }>
      >(
        `SELECT GREATEST(
                  $1::BIGINT,
                  COALESCE(pg_sequence_last_value('purchase_order_number_seq') + 1, $1::BIGINT)
                ) AS value`,
        [PURCHASE_ORDER_NUMBER_START],
      );
      sequence = Number(rows?.[0]?.value ?? PURCHASE_ORDER_NUMBER_START);
    } else {
      assertCounterFallbackAllowed();
      const rows = await this.dataSource.query<Array<{ next_value: number }>>(
        `SELECT next_value FROM purchase_order_number_counter WHERE id = 1`,
      );
      const next = Number(rows?.[0]?.next_value);
      if (Number.isFinite(next)) sequence = next;
    }

    return {
      nextNumber: formatPurchaseOrderNumber(sequence),
      nextSequence: String(sequence),
      preview: true,
    };
  }

  async create(
    dto: CreatePurchaseOrderDto,
    actor: AuthenticatedUser,
  ): Promise<PurchaseOrder> {
    if (dto.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        dto.warehouseId,
      );
    }

    // Resolve and authorize the division *before* opening the transaction, so
    // a rejected request never reaches allocateSequenceNumber and therefore
    // never burns a number from the sequence.
    const division = await this.resolveCreateDivision(actor, dto.division);
    this.assertRecyclingResource(division);
    const divisionStorage = this.divisionsService.storageValueFor(division);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // Declared outside the try so the post-commit audit/re-read below can
    // still see them once the connection has been released.
    const purchaseOrderId = randomUUID();
    let poNumber: string;
    let totals: ComputedPurchaseOrderTotals;

    try {
      const sequenceNumber = await this.allocateSequenceNumber(queryRunner);
      poNumber = formatPurchaseOrderNumber(sequenceNumber);
      totals = computePurchaseOrderTotals(purchaseOrderId, dto.items);

      const purchaseOrder = queryRunner.manager.create(PurchaseOrder, {
        id: purchaseOrderId,
        poNumber,
        sequenceNumber,
        orderDate: dto.orderDate,
        expectedDate: dto.expectedDate ?? null,
        currency: dto.currency ?? 'USD',
        supplierName: dto.supplierName,
        supplierAddress: dto.supplierAddress ?? null,
        supplierCity: dto.supplierCity ?? null,
        supplierProvince: dto.supplierProvince ?? null,
        supplierPostalCode: dto.supplierPostalCode ?? null,
        supplierCountry: dto.supplierCountry ?? null,
        supplierPhone: dto.supplierPhone ?? null,
        supplierEmail: dto.supplierEmail ?? null,
        companyInfo: dto.companyInfo ?? null,
        notes: dto.notes ?? null,
        total: totals.total,
        footerDate: dto.footerDate ?? null,
        status: dto.status ?? 'draft',
        warehouseId: dto.warehouseId ?? null,
        division: divisionStorage,
        createdBy: actor.id,
        updatedBy: actor.id,
      });

      await queryRunner.manager.save(PurchaseOrder, purchaseOrder);
      await queryRunner.manager.save(PurchaseOrderItem, totals.items);
      await queryRunner.commitTransaction();
    } catch (err) {
      // Only roll back a transaction that is still open: a failure raised
      // after commitTransaction() would otherwise be masked by the
      // "transaction not started" error thrown from here.
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw err;
    } finally {
      await queryRunner.release();
    }

    // IMPORTANT: everything below runs *after* the query runner has returned
    // its connection to the pool. Both the audit write and the re-read need a
    // connection of their own, and the pool defaults to 10 — doing them while
    // still holding the runner's connection is what deadlocked the API under
    // concurrent invoice creation. Same shape, same fix.
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'purchase_order.created',
      entityType: 'purchase_order',
      entityId: purchaseOrderId,
      warehouseId: dto.warehouseId ?? null,
      summary:
        `${actor.email} created purchase order ${poNumber} ` +
        `(supplier ${dto.supplierName}, total ${totals.total} ${dto.currency ?? 'USD'})`,
    });

    return this.findOneInternal(purchaseOrderId);
  }

  async update(
    id: string,
    dto: UpdatePurchaseOrderDto,
    actor: AuthenticatedUser,
  ): Promise<PurchaseOrder> {
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

    // Must hold the PO's current division, and the target one if it is moving.
    await this.divisionsService.assertStoredDivisionAccess(
      actor,
      existing.division,
    );
    this.assertRecyclingResource(existing.division);
    let divisionStorage = existing.division;
    if (dto.division !== undefined) {
      const target = await this.divisionsService.assertDivisionAccess(
        actor,
        dto.division,
      );
      if (target) {
        this.assertRecyclingResource(target);
        divisionStorage = this.divisionsService.storageValueFor(target);
      }
    }

    // Items are replaced wholesale when supplied; when omitted the existing
    // lines are re-run through the same calculation, so the stored total can
    // never drift from the stored lines.
    const items: PurchaseOrderItemDto[] =
      dto.items ??
      existing.items.map((item) => ({
        code: item.code ?? undefined,
        resin: item.resin ?? undefined,
        description: item.description,
        color: item.color ?? undefined,
        quantity: Number(item.quantity),
        unit: item.unit ?? undefined,
        unitPrice: Number(item.unitPrice),
      }));

    const totals = computePurchaseOrderTotals(id, items);

    await this.purchaseOrderItemRepository.delete({ purchaseOrderId: id });
    await this.purchaseOrderItemRepository.save(totals.items);

    await this.purchaseOrderRepository.update(id, {
      orderDate: dto.orderDate ?? existing.orderDate,
      expectedDate:
        dto.expectedDate !== undefined
          ? dto.expectedDate
          : existing.expectedDate,
      currency: dto.currency ?? existing.currency,
      supplierName: dto.supplierName ?? existing.supplierName,
      supplierAddress:
        dto.supplierAddress !== undefined
          ? dto.supplierAddress
          : existing.supplierAddress,
      supplierCity:
        dto.supplierCity !== undefined
          ? dto.supplierCity
          : existing.supplierCity,
      supplierProvince:
        dto.supplierProvince !== undefined
          ? dto.supplierProvince
          : existing.supplierProvince,
      supplierPostalCode:
        dto.supplierPostalCode !== undefined
          ? dto.supplierPostalCode
          : existing.supplierPostalCode,
      supplierCountry:
        dto.supplierCountry !== undefined
          ? dto.supplierCountry
          : existing.supplierCountry,
      supplierPhone:
        dto.supplierPhone !== undefined
          ? dto.supplierPhone
          : existing.supplierPhone,
      supplierEmail:
        dto.supplierEmail !== undefined
          ? dto.supplierEmail
          : existing.supplierEmail,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      companyInfo: (dto.companyInfo ?? existing.companyInfo) as any,
      notes: dto.notes !== undefined ? dto.notes : existing.notes,
      total: totals.total,
      footerDate:
        dto.footerDate !== undefined ? dto.footerDate : existing.footerDate,
      status: dto.status ?? existing.status,
      warehouseId: dto.warehouseId ?? existing.warehouseId,
      division: divisionStorage,
      updatedBy: actor.id,
      // poNumber and sequenceNumber are deliberately absent: a saved purchase
      // order keeps the number it was issued, for its whole life.
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'purchase_order.updated',
      entityType: 'purchase_order',
      entityId: id,
      warehouseId: dto.warehouseId ?? existing.warehouseId,
      summary: `${actor.email} updated purchase order ${existing.poNumber}`,
    });

    return this.findOneInternal(id);
  }

  async remove(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ id: string; poNumber: string; deleted: true }> {
    const existing = await this.findOneInternal(id);

    if (existing.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        existing.warehouseId,
      );
    }
    await this.divisionsService.assertStoredDivisionAccess(
      actor,
      existing.division,
    );
    this.assertRecyclingResource(existing.division);

    // Items go with it via ON DELETE CASCADE in PostgreSQL; deleted explicitly
    // first so the sqlite-backed specs (which synchronize the schema rather
    // than run the migration) behave identically.
    await this.purchaseOrderItemRepository.delete({ purchaseOrderId: id });
    await this.purchaseOrderRepository.delete({ id });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'purchase_order.deleted',
      entityType: 'purchase_order',
      entityId: id,
      warehouseId: existing.warehouseId,
      summary:
        `${actor.email} deleted purchase order ${existing.poNumber}. ` +
        'The number stays consumed and is never reissued.',
    });

    return { id, poNumber: existing.poNumber, deleted: true };
  }

  async findAll(
    actor: AuthenticatedUser,
    filters: {
      warehouseId?: string;
      status?: string;
      division?: string;
      search?: string;
    },
  ): Promise<PurchaseOrder[]> {
    if (filters.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        filters.warehouseId,
      );
    }

    const divisionValues = (
      await this.divisionsService.scopeDivisionStorageValues(
        actor,
        filters.division,
      )
    ).filter((value) => normalizeDivision(value) === DIVISION_GREENWAVE);
    if (divisionValues.length === 0) return [];

    const qb = this.purchaseOrderRepository
      .createQueryBuilder('po')
      .leftJoinAndSelect('po.items', 'items')
      .andWhere('po.division IN (:...divisionValues)', { divisionValues })
      // Newest first, but ordered by the sequence rather than a timestamp so
      // the list is stable for POs created in the same millisecond.
      .orderBy('po.sequenceNumber', 'DESC');

    if (filters.warehouseId) {
      qb.andWhere('po.warehouseId = :warehouseId', {
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
        qb.andWhere('po.warehouseId IS NULL');
      } else {
        qb.andWhere(
          '(po.warehouseId IN (:...authorizedIds) OR po.warehouseId IS NULL)',
          { authorizedIds },
        );
      }
    }

    if (filters.status) {
      qb.andWhere('po.status = :status', { status: filters.status });
    }

    if (filters.search) {
      // Parameterised, and matched against the two fields the list actually
      // exposes. Never interpolated into the SQL string.
      qb.andWhere(
        '(LOWER(po.poNumber) LIKE :search OR LOWER(po.supplierName) LIKE :search)',
        { search: `%${filters.search.toLowerCase()}%` },
      );
    }

    const results = await qb.getMany();
    for (const po of results) {
      po.items?.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return results;
  }

  async findOne(id: string, actor: AuthenticatedUser): Promise<PurchaseOrder> {
    const purchaseOrder = await this.findOneInternal(id);
    if (purchaseOrder.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        purchaseOrder.warehouseId,
      );
    }
    await this.divisionsService.assertStoredDivisionAccess(
      actor,
      purchaseOrder.division,
    );
    this.assertRecyclingResource(purchaseOrder.division);
    return purchaseOrder;
  }

  /**
   * Purchase orders are GreenWave Recycling records. Holding another division does not
   * make that division's rows reachable through this module, so the stored (or
   * requested) division is checked on its own, after the actor checks — the
   * same invariant PaymentsService.assertInvoiceAccess applies.
   */
  private assertRecyclingResource(division: string | null | undefined): void {
    if (normalizeDivision(division) !== DIVISION_GREENWAVE) {
      throw new ForbiddenException(
        'Financial operations are strictly restricted to the GreenWave Recycling division',
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

  private async findOneInternal(id: string): Promise<PurchaseOrder> {
    const purchaseOrder = await this.purchaseOrderRepository.findOne({
      where: { id },
      relations: ['items'],
    });
    // Deliberately the same message whether the id is unknown or malformed, so
    // the endpoint cannot be used to probe which ids exist.
    if (!purchaseOrder) throw new NotFoundException('Purchase order not found');
    purchaseOrder.items.sort((a, b) => a.sortOrder - b.sortOrder);
    return purchaseOrder;
  }

  /**
   * Generates a clean vector A4 PDF using Playwright Chromium.
   * Enforces exact A4 portrait dimensions, zero browser headers/footers,
   * embedded logo and CSS, and selectable text.
   */
  async generatePdf(docHtml: string): Promise<Buffer> {
    const fs = require('fs');
    const path = require('path');

    // 1. Resolve logo and embed as base64 data URI for offline reliability
    let logoDataUri = '';
    const logoCandidates = [
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
        /src=["']assets\/logo\.png[^"']*["']/g,
        `src="${logoDataUri}"`,
      );
    }

    // 2. Resolve stylesheet
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
  <title>PURCHASE ORDER</title>
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
    .po-page {
      width: 210mm !important;
      min-height: 297mm !important;
      box-sizing: border-box !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      padding: 12mm 14mm !important;
      background: #ffffff !important;
    }
    .po-table thead {
      display: table-header-group;
    }
    .po-table tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .po-letterhead, .po-infobox, .po-supplier, .po-foot, .po-doc-footer {
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
