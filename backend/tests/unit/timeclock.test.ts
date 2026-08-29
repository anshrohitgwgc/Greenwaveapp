import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

interface Shift {
  id: string;
  userId: number;
  warehouseId: string;
  clockIn: Date;
  clockOut: Date | null;
}

class ShiftTracker {
  private shifts: Shift[] = [];

  clockIn(userId: number, warehouseId: string, now: Date = new Date()): Shift {
    const active = this.shifts.find((s) => s.userId === userId && s.clockOut === null);
    if (active) {
      const err = new Error('User already has an active shift');
      (err as any).status = 409;
      throw err;
    }
    const shift: Shift = {
      id: 'shift-' + (this.shifts.length + 1),
      userId,
      warehouseId,
      clockIn: now,
      clockOut: null,
    };
    this.shifts.push(shift);
    return shift;
  }

  clockOut(userId: number, now: Date = new Date()): Shift {
    const active = this.shifts.find((s) => s.userId === userId && s.clockOut === null);
    if (!active) {
      const err = new Error('No active shift found');
      (err as any).status = 404;
      throw err;
    }
    active.clockOut = now;
    return active;
  }

  getActiveShifts(warehouseId?: string): Shift[] {
    return this.shifts.filter((s) => s.clockOut === null && (!warehouseId || s.warehouseId === warehouseId));
  }
}

describe('Unit: Staff Time Clock & Shift Integrity', () => {
  it('1. Successfully clocks in and clocks out a staff member with warehouse association', () => {
    const tracker = new ShiftTracker();
    const t0 = new Date('2026-08-28T08:00:00Z');
    const t1 = new Date('2026-08-28T16:30:00Z');

    const shift = tracker.clockIn(101, 'CGY', t0);
    assert.equal(shift.userId, 101);
    assert.equal(shift.warehouseId, 'CGY');
    assert.equal(shift.clockOut, null);

    const active = tracker.getActiveShifts('CGY');
    assert.equal(active.length, 1);

    const completed = tracker.clockOut(101, t1);
    assert.equal(completed.clockOut, t1);
    assert.equal(tracker.getActiveShifts('CGY').length, 0);
  });

  it('2. Prevents duplicate active shifts for the same user (409 Conflict)', () => {
    const tracker = new ShiftTracker();
    tracker.clockIn(102, 'ON');

    assert.throws(
      () => tracker.clockIn(102, 'ON'),
      (err: any) => err.status === 409,
    );
  });
});
