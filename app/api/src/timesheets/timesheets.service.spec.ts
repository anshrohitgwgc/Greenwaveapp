import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditService } from '../audit/audit.service';
import { Timesheet } from './entities/timesheet.entity';
import { TimesheetsService } from './timesheets.service';

describe('TimesheetsService', () => {
  let service: TimesheetsService;
  let repo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };

  const actor = { id: 1, role: 'staff', email: 'staff@example.com' };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ ...data })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimesheetsService,
        { provide: getRepositoryToken(Timesheet), useValue: repo },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(TimesheetsService);
  });

  it('clocks in when there is no active shift', async () => {
    repo.findOne.mockResolvedValue(null);

    const shift = await service.clockIn({}, actor);

    expect(shift.userId).toBe(1);
    expect(shift.clockOut).toBeNull();
  });

  it('refuses a second clock-in while a shift is already open', async () => {
    repo.findOne.mockResolvedValue({ id: 'shift-1', userId: 1, clockOut: null });

    await expect(service.clockIn({}, actor)).rejects.toThrow(ConflictException);
  });

  it('clocks out an active shift', async () => {
    const active = { id: 'shift-1', userId: 1, clockIn: new Date(), clockOut: null };
    repo.findOne.mockResolvedValue(active);

    const result = await service.clockOut(actor);

    expect(result.clockOut).toBeInstanceOf(Date);
  });

  it('refuses to clock out when there is no active shift', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.clockOut(actor)).rejects.toThrow(NotFoundException);
  });
});
