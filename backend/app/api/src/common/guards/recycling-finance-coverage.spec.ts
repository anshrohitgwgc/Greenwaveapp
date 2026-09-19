import { GUARDS_METADATA } from '@nestjs/common/constants';

import { InvoicesController } from '../../invoices/invoices.controller';
import { PaymentsController } from '../../payments/payments.controller';
import { ProformasController } from '../../proformas/proformas.controller';
import { PurchaseOrdersController } from '../../purchase-orders/purchase-orders.controller';
import { RecyclingFinanceGuard } from './recycling-finance.guard';

/**
 * Invoices, purchase orders, proformas and payments are GreenWave Recycling
 * records. The division boundary is a class-level guard, so it covers every
 * route a controller has now or gains later; this locks that in place.
 */
describe('RecyclingFinanceGuard coverage', () => {
  it.each([
    ['InvoicesController', InvoicesController],
    ['PurchaseOrdersController', PurchaseOrdersController],
    ['ProformasController', ProformasController],
    ['PaymentsController', PaymentsController],
  ])('%s is guarded at class level', (_name, controller) => {
    const guards =
      (Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? [];
    expect(guards).toContain(RecyclingFinanceGuard);
  });
});
