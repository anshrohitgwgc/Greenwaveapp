import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { EmployeesService } from './employees.service';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { Employee } from './entities/employee.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import { LeaveRequest } from './entities/leave-request.entity';

describe('EmployeesService', () => {
  let service: EmployeesService;
  let employeesRepo: any;
  let attendanceRepo: any;
  let leaveBalancesRepo: any;
  let leaveRequestsRepo: any;

  beforeEach(async () => {
    employeesRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve({ id: 'emp-1', ...entity })),
      createQueryBuilder: jest.fn(),
    };

    attendanceRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    leaveBalancesRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    leaveRequestsRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn(),
    };

    const mockDataSource = {
      transaction: jest.fn((cb) => cb({
        getRepository: jest.fn((entity) => {
          if (entity === Employee) return employeesRepo;
          if (entity === AttendanceRecord) return attendanceRepo;
          if (entity === LeaveBalance) return leaveBalancesRepo;
          if (entity === LeaveRequest) return leaveRequestsRepo;
          return {};
        }),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: getRepositoryToken(Employee), useValue: employeesRepo },
        { provide: getRepositoryToken(AttendanceRecord), useValue: attendanceRepo },
        { provide: getRepositoryToken(LeaveBalance), useValue: leaveBalancesRepo },
        { provide: getRepositoryToken(LeaveRequest), useValue: leaveRequestsRepo },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<EmployeesService>(EmployeesService);
  });

  describe('getEmployeeForUserOrFail', () => {
    it('should return employee if found for userId', async () => {
      const mockEmp = { id: 'emp-10', userId: 5, firstName: 'Jane', lastName: 'Doe' };
      employeesRepo.findOne.mockResolvedValue(mockEmp);

      const result = await service.getEmployeeForUserOrFail(5);
      expect(result).toBe(mockEmp);
      expect(employeesRepo.findOne).toHaveBeenCalledWith({ where: { userId: 5 } });
    });

    it('should throw NotFoundException if no employee associated with user', async () => {
      employeesRepo.findOne.mockResolvedValue(null);

      await expect(service.getEmployeeForUserOrFail(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('assertCanAccessEmployee', () => {
    it('should allow admin to access any employee', async () => {
      const mockEmp = { id: 'emp-20', userId: 10, role: 'staff' };
      employeesRepo.findOne.mockResolvedValue(mockEmp);

      const actor = { id: 1, role: 'admin', permissions: ['all'] } as any;
      const result = await service.assertCanAccessEmployee(actor, 'emp-20');
      expect(result).toBe(mockEmp);
    });

    it('should allow user to access their own employee profile', async () => {
      const mockEmp = { id: 'emp-self', userId: 42 };
      employeesRepo.findOne.mockResolvedValue(mockEmp);

      const actor = { id: 42, role: 'staff', permissions: [] } as any;
      const result = await service.assertCanAccessEmployee(actor, 'emp-self');
      expect(result).toBe(mockEmp);
    });

    it('should deny unauthorized staff from accessing another employee', async () => {
      const mockEmp = { id: 'emp-other', userId: 99 };
      employeesRepo.findOne.mockResolvedValue(mockEmp);

      const actor = { id: 42, role: 'staff', permissions: [] } as any;
      await expect(service.assertCanAccessEmployee(actor, 'emp-other')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('reviewLeaveRequest', () => {
    it('should throw NotFoundException if leave request not found', async () => {
      leaveRequestsRepo.findOne.mockResolvedValue(null);

      const actor = { id: 1, role: 'admin' } as any;
      await expect(
        service.reviewLeaveRequest(actor, 'req-not-found', { status: 'APPROVED' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if leave request is not SUBMITTED', async () => {
      leaveRequestsRepo.findOne.mockResolvedValue({
        id: 'req-already-done',
        status: 'APPROVED',
        employeeId: 'emp-1',
      });

      const actor = { id: 1, role: 'admin' } as any;
      await expect(
        service.reviewLeaveRequest(actor, 'req-already-done', { status: 'APPROVED' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should approve leave request, update leave balance, and create attendance records', async () => {
      const mockReq = {
        id: 'req-1',
        employeeId: 'emp-1',
        status: 'SUBMITTED',
        leaveType: 'VACATION',
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        daysCount: 2,
      };
      leaveRequestsRepo.findOne.mockResolvedValue(mockReq);

      const mockEmp = { id: 'emp-1', userId: 10 };
      employeesRepo.findOne.mockResolvedValue(mockEmp);

      const mockBalance = {
        employeeId: 'emp-1',
        leaveType: 'VACATION',
        pendingDays: 2,
        usedDays: 0,
      };
      leaveBalancesRepo.findOne.mockResolvedValue(mockBalance);

      attendanceRepo.findOne.mockResolvedValue(null);

      const actor = { id: 1, role: 'admin', email: 'admin@gwgc.ca' } as any;
      const result = await service.reviewLeaveRequest(actor, 'req-1', {
        status: 'APPROVED',
        comments: 'Approved by Ops Director',
      });

      expect(result.status).toBe('APPROVED');
      expect(result.reviewedBy).toBe(1);
      expect(mockBalance.pendingDays).toBe(0);
      expect(mockBalance.usedDays).toBe(2);
      expect(leaveBalancesRepo.save).toHaveBeenCalledWith(mockBalance);
      expect(attendanceRepo.save).toHaveBeenCalled();
    });
  });
});
