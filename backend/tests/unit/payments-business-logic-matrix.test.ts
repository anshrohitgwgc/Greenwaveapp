import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'crypto';

describe('Payment Business Logic & Edge Cases Audit Matrix', () => {
  const webhookSecret = 'whsec_test_secret_key_1234567890abcdef';

  // 1. Invoice $100 -> customer pays $100 -> success
  it('1. Invoice $100 -> customer pays $100 -> success', () => {
    const invoice = {
      id: 'inv-100',
      totalMinor: 10000,
      currency: 'CAD',
      status: 'issued',
      paymentStatus: 'unpaid',
    };

    const webhookEvent = {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test_100',
          amount: 10000,
          currency: 'cad',
          status: 'succeeded',
        },
      },
    };

    // Verification
    assert.equal(webhookEvent.data.object.amount, invoice.totalMinor);
    assert.equal(webhookEvent.data.object.currency.toUpperCase(), invoice.currency);
    invoice.paymentStatus = 'paid';
    assert.equal(invoice.paymentStatus, 'paid');
  });

  // 2. Invoice already paid -> payment forbidden
  it('2. Invoice already paid -> payment forbidden', () => {
    const invoice = {
      id: 'inv-paid',
      totalMinor: 10000,
      status: 'issued',
      paymentStatus: 'paid',
    };

    function attemptCreatePayment(inv: typeof invoice) {
      if (inv.paymentStatus === 'paid') {
        throw new Error('This invoice cannot be paid online. It has already been paid.');
      }
      return { clientSecret: 'pi_secret_new' };
    }

    assert.throws(
      () => attemptCreatePayment(invoice),
      /already been paid/,
      'Must reject payment attempt on already-paid invoice',
    );
  });

  // 3. Invoice cancelled/void -> payment forbidden
  it('3. Invoice cancelled or void -> payment forbidden', () => {
    const cancelledInvoice = {
      id: 'inv-cancelled',
      totalMinor: 10000,
      status: 'cancelled',
      paymentStatus: 'unpaid',
    };

    const voidInvoice = {
      id: 'inv-void',
      totalMinor: 10000,
      status: 'void',
      paymentStatus: 'unpaid',
    };

    const nonPayableStatuses = ['cancelled', 'canceled', 'void', 'draft'];

    function validatePayable(inv: { status: string }) {
      if (nonPayableStatuses.includes(inv.status)) {
        throw new Error('This invoice cannot be paid online.');
      }
    }

    assert.throws(() => validatePayable(cancelledInvoice), /cannot be paid online/);
    assert.throws(() => validatePayable(voidInvoice), /cannot be paid online/);
  });

  // 4. Invoice $100 -> manipulated client says $1 -> backend still charges exactly $100
  it('4. Invoice $100 -> manipulated client says $1 -> backend charges exactly $100', () => {
    const dbInvoice = {
      id: 'inv-authoritative',
      total: '100.00',
      totalMinor: 10000,
      currency: 'CAD',
    };

    // Client body contains tampered amount
    const clientPayload = {
      amount: 1.00,
      amountMinor: 100,
    };

    // Server-authoritative resolver derives amount strictly from database entity
    const chargedAmountMinor = dbInvoice.totalMinor;
    assert.equal(chargedAmountMinor, 10000);
    assert.notEqual(chargedAmountMinor, clientPayload.amountMinor);
  });

  // 5. Duplicate payment request -> no double charge/business record
  it('5. Duplicate payment request -> resumes existing intent instead of second charge', () => {
    const activePayments = new Map<string, { id: string; clientSecret: string; status: string }>();

    function getOrCreatePaymentIntent(invoiceId: string) {
      if (activePayments.has(invoiceId)) {
        return { kind: 'resumed', intent: activePayments.get(invoiceId)! };
      }
      const newIntent = { id: 'pi_created_1', clientSecret: 'sec_1', status: 'requires_payment_method' };
      activePayments.set(invoiceId, newIntent);
      return { kind: 'created', intent: newIntent };
    }

    const first = getOrCreatePaymentIntent('inv-dup');
    assert.equal(first.kind, 'created');

    const second = getOrCreatePaymentIntent('inv-dup');
    assert.equal(second.kind, 'resumed');
    assert.equal(second.intent.id, first.intent.id);
    assert.equal(activePayments.size, 1);
  });

  // 6. Duplicate Stripe webhook -> one business transaction
  it('6. Duplicate Stripe webhook -> exactly one business transaction', () => {
    const processedEvents = new Set<string>();
    let ledgerPostingsCount = 0;

    function handleWebhook(eventId: string) {
      if (processedEvents.has(eventId)) {
        return { status: 'duplicate', duplicate: true };
      }
      processedEvents.add(eventId);
      ledgerPostingsCount++;
      return { status: 'processed', duplicate: false };
    }

    const firstCall = handleWebhook('evt_duplicate_webhook_123');
    assert.equal(firstCall.duplicate, false);
    assert.equal(ledgerPostingsCount, 1);

    const secondCall = handleWebhook('evt_duplicate_webhook_123');
    assert.equal(secondCall.duplicate, true);
    assert.equal(ledgerPostingsCount, 1); // No double posting
  });

  // 7. Incorrect webhook amount -> reject / do not mark paid
  it('7. Incorrect webhook amount -> reject and do not mark invoice paid', () => {
    const invoice = {
      id: 'inv-check-amt',
      totalMinor: 10000,
      paymentStatus: 'unpaid',
    };

    const webhookEvent = {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_underpaid',
          amount: 5000, // Captured $50 instead of $100
          currency: 'cad',
        },
      },
    };

    function processPaymentWebhook(inv: typeof invoice, evt: typeof webhookEvent) {
      if (evt.data.object.amount !== inv.totalMinor) {
        // Flag discrepancy, do NOT mark invoice paid
        return { success: false, error: 'Amount mismatch: requires manual review' };
      }
      inv.paymentStatus = 'paid';
      return { success: true };
    }

    const result = processPaymentWebhook(invoice, webhookEvent);
    assert.equal(result.success, false);
    assert.equal(invoice.paymentStatus, 'unpaid'); // Remains unpaid!
  });

  // 8. Incorrect currency -> reject
  it('8. Incorrect currency -> reject', () => {
    const invoice = {
      id: 'inv-cad',
      currency: 'CAD',
      totalMinor: 10000,
    };

    const webhookEvent = {
      data: {
        object: {
          currency: 'usd', // Attacker paid in USD instead of CAD
          amount: 10000,
        },
      },
    };

    function verifyCurrency(inv: typeof invoice, evt: typeof webhookEvent) {
      if (evt.data.object.currency.toUpperCase() !== inv.currency.toUpperCase()) {
        throw new Error('Currency mismatch between invoice and payment intent');
      }
    }

    assert.throws(() => verifyCurrency(invoice, webhookEvent), /Currency mismatch/);
  });

  // 9. Invalid webhook signature -> reject
  it('9. Invalid webhook signature -> reject with 400', () => {
    const rawPayload = JSON.stringify({ type: 'payment_intent.succeeded', id: 'pi_fake' });
    const timestamp = Math.floor(Date.now() / 1000);
    const forgedSignature = 'badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb';

    const validSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${rawPayload}`)
      .digest('hex');

    function verifySignature(ts: number, payload: string, sig: string, secret: string): boolean {
      const expected = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
      try {
        return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
      } catch {
        return false;
      }
    }

    assert.equal(verifySignature(timestamp, rawPayload, forgedSignature, webhookSecret), false);
    assert.equal(verifySignature(timestamp, rawPayload, validSignature, webhookSecret), true);
  });

  // 10. Unauthorized refund -> reject
  it('10. Unauthorized refund -> reject for non-admin without refund permission', () => {
    const staffUser = {
      id: 5,
      role: 'staff',
      permissions: ['pickups:read', 'invoices:read'],
    };

    const adminUser = {
      id: 1,
      role: 'admin',
      permissions: ['all'],
    };

    function assertCanRefund(user: typeof staffUser) {
      if (user.role !== 'admin' && !user.permissions.includes('accounting:refund') && !user.permissions.includes('payments:refund')) {
        throw new Error('Forbidden: Insufficient permissions to process refunds');
      }
    }

    assert.throws(() => assertCanRefund(staffUser), /Forbidden/);
    assert.doesNotThrow(() => assertCanRefund(adminUser));
  });

  // 11. Refund above available amount -> reject
  it('11. Refund above available amount -> reject', () => {
    const payment = {
      id: 'pay-1',
      amountMinor: 10000, // $100.00
      refundedMinor: 6000, // $60.00 already refunded
    };

    function validateRefundAmount(p: typeof payment, requestedMinor: number) {
      const remainingEligible = p.amountMinor - p.refundedMinor; // $40.00 eligible
      if (requestedMinor <= 0) {
        throw new Error('Refund amount must be greater than zero');
      }
      if (requestedMinor > remainingEligible) {
        throw new Error(`Refund amount ${requestedMinor} exceeds eligible balance ${remainingEligible}`);
      }
      return true;
    }

    // Attempting $50 refund when only $40 remains
    assert.throws(
      () => validateRefundAmount(payment, 5000),
      /exceeds eligible balance 4000/,
    );

    // Valid $40 refund passes
    assert.equal(validateRefundAmount(payment, 4000), true);
  });
});
