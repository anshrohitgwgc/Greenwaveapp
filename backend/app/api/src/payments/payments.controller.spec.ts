import { Test, TestingModule } from '@nestjs/testing';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: {
    getPaymentMetrics: jest.Mock;
    getOrCreatePaymentLink: jest.Mock;
    sendInvoiceEmail: jest.Mock;
    refundPayment: jest.Mock;
  };

  beforeEach(async () => {
    paymentsService = {
      getPaymentMetrics: jest
        .fn()
        .mockResolvedValue({ totalOutstanding: 1000, paidThisMonth: 500 }),
      getOrCreatePaymentLink: jest
        .fn()
        .mockResolvedValue({ paymentUrl: '/pay/token123' }),
      sendInvoiceEmail: jest.fn().mockResolvedValue({ success: true }),
      refundPayment: jest
        .fn()
        .mockResolvedValue({ success: true, status: 'refunded' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: PaymentsService,
          useValue: paymentsService,
        },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns payment metrics for authorized actor', async () => {
    const actor: AuthenticatedUser = {
      id: 1,
      email: 'admin@greenwave.test',
      role: 'admin',
      fullName: 'Admin User',
      permissions: ['payments:manage'],
    };
    const res = await controller.getMetrics(actor, 'wh-1');
    expect(paymentsService.getPaymentMetrics).toHaveBeenCalledWith(
      actor,
      'wh-1',
    );
    expect(res.totalOutstanding).toBe(1000);
  });

  it('generates payment link for invoice', async () => {
    const actor: AuthenticatedUser = {
      id: 1,
      email: 'admin@greenwave.test',
      role: 'admin',
      fullName: 'Admin User',
      permissions: ['payments:manage'],
    };
    const res = await controller.getPaymentLink('inv-1', actor);
    expect(paymentsService.getOrCreatePaymentLink).toHaveBeenCalledWith(
      'inv-1',
      actor,
    );
    expect(res.paymentUrl).toBe('/pay/token123');
  });
});
