import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { addDays, daysBetween, toBusinessDate } from '../common/dates';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { WarehousesService } from '../warehouses/warehouses.service';
import {
  CreateEmployeeDto,
  ListAttendanceQueryDto,
  ListEmployeesQueryDto,
  RecordAttendanceDto,
  ReviewLeaveRequestDto,
  SubmitLeaveRequestDto,
  UpdateEmployeeDto,
  UpdateLeaveBalanceDto,
} from './dto/employees.dto';
import { AttendanceRecord, AttendanceStatus } from './entities/attendance-record.entity';
import { Employee } from './entities/employee.entity';
import { LeaveBalance, LeaveType } from './entities/leave-balance.entity';
import { LeaveRequest } from './entities/leave-request.entity';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(AttendanceRecord) private readonly attendance: Repository<AttendanceRecord>,
    @InjectRepository(LeaveBalance) private readonly leaveBalances: Repository<LeaveBalance>,
    @InjectRepository(LeaveRequest) private readonly leaveRequests: Repository<LeaveRequest>,
    @InjectDataSource() private readonly ds: DataSource,
    @Optional() private readonly warehouses?: WarehousesService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  // --------------------------------------------------------------------------
  // Authorization & Scoping Helpers
  // --------------------------------------------------------------------------

  async getEmployeeForUser(userId: number): Promise<Employee | null> {
    return this.employees.findOne({ where: { userId } });
  }

  async getEmployeeForUserOrFail(userId: number): Promise<Employee> {
    const emp = await this.getEmployeeForUser(userId);
    if (!emp) {
      throw new NotFoundException('No employee record associated with your user account');
    }
    return emp;
  }

  async assertCanAccessEmployee(actor: AuthenticatedUser, targetEmployeeId: string): Promise<Employee> {
    const target = await this.employees.findOne({ where: { id: targetEmployeeId } });
    if (!target) throw new NotFoundException('Employee not found');

    if (actor.role === 'admin') return target;

    // Self access
    if (target.userId === actor.id) return target;

    // Manager access: can access direct reports or employees in their authorized warehouses
    if (actor.role === 'manager') {
      const actorEmp = await this.getEmployeeForUser(actor.id);
      if (actorEmp && target.managerId === actorEmp.id) {
        return target;
      }
      if (target.warehouseId && this.warehouses) {
        const hasAccess = await this.warehouses.isUserAuthorizedForWarehouse(
          actor.id,
          actor.role,
          target.warehouseId,
          actor.permissions,
        );
        if (hasAccess) return target;
      }
    }

    throw new ForbiddenException('You are not authorized to view or manage this employee');
  }

  // --------------------------------------------------------------------------
  // Employee Directory & CRUD
  // --------------------------------------------------------------------------

  async listEmployees(actor: AuthenticatedUser, q: ListEmployeesQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;

    const qb = this.employees.createQueryBuilder('e');

    if (actor.role === 'admin') {
      // Full access to all employees
      if (q.department) qb.andWhere('e.department = :dept', { dept: q.department });
      if (q.status) qb.andWhere('e.status = :status', { status: q.status });
      if (q.warehouseId) qb.andWhere('e.warehouseId = :wId', { wId: q.warehouseId });
      if (q.managerId) qb.andWhere('e.managerId = :mId', { mId: q.managerId });
    } else if (actor.role === 'manager') {
      const actorEmp = await this.getEmployeeForUser(actor.id);
      let authorizedWarehouseIds: string[] = [];
      if (this.warehouses) {
        authorizedWarehouseIds = await this.warehouses.getUserAuthorizedWarehouseIds(
          actor.id,
          actor.role,
          actor.permissions,
        );
      }

      qb.andWhere(
        '(e.userId = :userId OR e.managerId = :managerEmpId' +
          (authorizedWarehouseIds.length > 0 ? ' OR e.warehouseId IN (:...wIds)' : '') +
          ')',
        {
          userId: actor.id,
          managerEmpId: actorEmp ? actorEmp.id : '00000000-0000-0000-0000-000000000000',
          wIds: authorizedWarehouseIds,
        },
      );
    } else {
      // Staff / Driver: only their own record
      qb.andWhere('e.userId = :userId', { userId: actor.id });
    }

    if (q.q?.trim()) {
      const search = `%${q.q.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(e.firstName) LIKE :s OR LOWER(e.lastName) LIKE :s OR LOWER(e.email) LIKE :s OR LOWER(e.employeeId) LIKE :s OR LOWER(e.position) LIKE :s)',
        { s: search },
      );
    }

    const [items, total] = await qb
      .orderBy('e.lastName', 'ASC')
      .addOrderBy('e.firstName', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
    };
  }

  async getEmployee(actor: AuthenticatedUser, id: string) {
    return this.assertCanAccessEmployee(actor, id);
  }

  async createEmployee(actor: AuthenticatedUser, dto: CreateEmployeeDto) {
    const existing = await this.employees.findOne({ where: { employeeId: dto.employeeId } });
    if (existing) {
      throw new ConflictException(`Employee ID "${dto.employeeId}" is already in use`);
    }

    const employee = await this.employees.save(
      this.employees.create({
        id: randomUUID(),
        employeeId: dto.employeeId.trim(),
        userId: dto.userId ?? null,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone?.trim() ?? null,
        department: dto.department.trim(),
        position: dto.position.trim(),
        startDate: dto.startDate,
        endDate: dto.endDate ?? null,
        status: dto.status ?? 'ACTIVE',
        employmentType: dto.employmentType ?? 'FULL_TIME',
        managerId: dto.managerId ?? null,
        warehouseId: dto.warehouseId ?? null,
        isActive: true,
      }),
    );

    // Initialize default leave balances for current year
    const currentYear = new Date().getFullYear();
    const defaultBalances = [
      { type: 'VACATION' as LeaveType, days: 15 },
      { type: 'SICK' as LeaveType, days: 10 },
      { type: 'PERSONAL' as LeaveType, days: 5 },
      { type: 'OTHER' as LeaveType, days: 0 },
    ];

    const balances = defaultBalances.map((b) =>
      this.leaveBalances.create({
        id: randomUUID(),
        employeeId: employee.id,
        year: currentYear,
        leaveType: b.type,
        entitlementDays: b.days,
        usedDays: 0,
        pendingDays: 0,
      }),
    );
    await this.leaveBalances.save(balances);

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'employees.created',
      entityType: 'employee',
      entityId: employee.id,
      summary: `${actor.email} created employee "${employee.firstName} ${employee.lastName}" (${employee.employeeId})`,
      metadata: { employeeId: employee.employeeId, department: employee.department },
    });

    return employee;
  }

  async updateEmployee(actor: AuthenticatedUser, id: string, dto: UpdateEmployeeDto) {
    const employee = await this.employees.findOne({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');

    if (dto.firstName !== undefined) employee.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) employee.lastName = dto.lastName.trim();
    if (dto.email !== undefined) employee.email = dto.email.trim().toLowerCase();
    if (dto.phone !== undefined) employee.phone = dto.phone ? dto.phone.trim() : null;
    if (dto.department !== undefined) employee.department = dto.department.trim();
    if (dto.position !== undefined) employee.position = dto.position.trim();
    if (dto.startDate !== undefined) employee.startDate = dto.startDate;
    if (dto.endDate !== undefined) employee.endDate = dto.endDate ?? null;
    if (dto.status !== undefined) {
      employee.status = dto.status;
      if (dto.status === 'TERMINATED') {
        employee.isActive = false;
      }
    }
    if (dto.employmentType !== undefined) employee.employmentType = dto.employmentType;
    if (dto.managerId !== undefined) employee.managerId = dto.managerId ?? null;
    if (dto.warehouseId !== undefined) employee.warehouseId = dto.warehouseId ?? null;

    const saved = await this.employees.save(employee);

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'employees.updated',
      entityType: 'employee',
      entityId: saved.id,
      summary: `${actor.email} updated employee "${saved.firstName} ${saved.lastName}"`,
    });

    return saved;
  }

  // --------------------------------------------------------------------------
  // Attendance Tracking
  // --------------------------------------------------------------------------

  async recordAttendance(actor: AuthenticatedUser, dto: RecordAttendanceDto) {
    let targetEmpId = dto.employeeId;
    if (!targetEmpId) {
      const ownEmp = await this.getEmployeeForUserOrFail(actor.id);
      targetEmpId = ownEmp.id;
    } else {
      await this.assertCanAccessEmployee(actor, targetEmpId);
    }

    let clockInDate: Date | null = null;
    let clockOutDate: Date | null = null;

    if (dto.clockIn) {
      clockInDate = new Date(dto.clockIn);
    }
    if (dto.clockOut) {
      clockOutDate = new Date(dto.clockOut);
    }

    let totalHours = dto.totalHours ?? 0;
    if (totalHours === 0 && clockInDate && clockOutDate) {
      const diffMs = clockOutDate.getTime() - clockInDate.getTime();
      totalHours = Math.max(0, parseFloat((diffMs / (1000 * 60 * 60)).toFixed(2)));
    }

    const overtimeHours = dto.overtimeHours ?? (totalHours > 8 ? parseFloat((totalHours - 8).toFixed(2)) : 0);

    const existing = await this.attendance.findOne({
      where: { employeeId: targetEmpId, date: dto.date },
    });

    let record: AttendanceRecord;
    if (existing) {
      if (clockInDate) existing.clockIn = clockInDate;
      if (clockOutDate) existing.clockOut = clockOutDate;
      existing.totalHours = totalHours;
      existing.overtimeHours = overtimeHours;
      if (dto.status) existing.status = dto.status;
      if (dto.notes !== undefined) existing.notes = dto.notes;
      existing.verifiedBy = actor.id;
      record = await this.attendance.save(existing);
    } else {
      record = await this.attendance.save(
        this.attendance.create({
          id: randomUUID(),
          employeeId: targetEmpId,
          date: dto.date,
          clockIn: clockInDate,
          clockOut: clockOutDate,
          totalHours,
          overtimeHours,
          status: dto.status ?? 'PRESENT',
          notes: dto.notes ?? null,
          source: 'MANUAL',
          verifiedBy: actor.id,
        }),
      );
    }

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'attendance.recorded',
      entityType: 'attendance_record',
      entityId: record.id,
      summary: `${actor.email} recorded attendance for employee on ${record.date} (${record.status}, ${record.totalHours} hrs)`,
      metadata: { employeeId: targetEmpId, date: record.date, status: record.status },
    });

    return record;
  }

  async listAttendance(actor: AuthenticatedUser, q: ListAttendanceQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;

    const qb = this.attendance
      .createQueryBuilder('a')
      .leftJoinAndSelect('employees', 'e', 'e.id = a.employee_id');

    if (actor.role === 'admin') {
      if (q.employeeId) qb.andWhere('a.employeeId = :empId', { empId: q.employeeId });
      if (q.department) qb.andWhere('e.department = :dept', { dept: q.department });
    } else if (actor.role === 'manager') {
      const actorEmp = await this.getEmployeeForUser(actor.id);
      let authorizedWarehouseIds: string[] = [];
      if (this.warehouses) {
        authorizedWarehouseIds = await this.warehouses.getUserAuthorizedWarehouseIds(
          actor.id,
          actor.role,
          actor.permissions,
        );
      }

      qb.andWhere(
        '(e.userId = :userId OR e.managerId = :managerEmpId' +
          (authorizedWarehouseIds.length > 0 ? ' OR e.warehouseId IN (:...wIds)' : '') +
          ')',
        {
          userId: actor.id,
          managerEmpId: actorEmp ? actorEmp.id : '00000000-0000-0000-0000-000000000000',
          wIds: authorizedWarehouseIds,
        },
      );

      if (q.employeeId) qb.andWhere('a.employeeId = :empId', { empId: q.employeeId });
    } else {
      // Staff / Driver: own records only
      const ownEmp = await this.getEmployeeForUser(actor.id);
      if (!ownEmp) return { items: [], total: 0, page, pageSize, pageCount: 0 };
      qb.andWhere('a.employeeId = :empId', { empId: ownEmp.id });
    }

    if (q.from) qb.andWhere('a.date >= :from', { from: q.from });
    if (q.to) qb.andWhere('a.date <= :to', { to: q.to });
    if (q.status) qb.andWhere('a.status = :status', { status: q.status });

    const [items, total] = await qb
      .orderBy('a.date', 'DESC')
      .addOrderBy('a.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
    };
  }

  // --------------------------------------------------------------------------
  // Leave Management & Approval Workflow
  // --------------------------------------------------------------------------

  async getLeaveBalances(actor: AuthenticatedUser, employeeId?: string, year?: number) {
    let targetEmpId = employeeId;
    if (!targetEmpId) {
      const ownEmp = await this.getEmployeeForUserOrFail(actor.id);
      targetEmpId = ownEmp.id;
    } else {
      await this.assertCanAccessEmployee(actor, targetEmpId);
    }

    const targetYear = year ?? new Date().getFullYear();
    const balances = await this.leaveBalances.find({
      where: { employeeId: targetEmpId, year: targetYear },
    });

    return balances.map((b) => ({
      ...b,
      remainingDays: parseFloat((Number(b.entitlementDays) - Number(b.usedDays) - Number(b.pendingDays)).toFixed(2)),
    }));
  }

  async updateLeaveBalance(
    actor: AuthenticatedUser,
    employeeId: string,
    leaveType: LeaveType,
    dto: UpdateLeaveBalanceDto,
    year?: number,
  ) {
    const targetYear = year ?? new Date().getFullYear();
    let balance = await this.leaveBalances.findOne({
      where: { employeeId, year: targetYear, leaveType },
    });

    if (!balance) {
      balance = this.leaveBalances.create({
        id: randomUUID(),
        employeeId,
        year: targetYear,
        leaveType,
        entitlementDays: dto.entitlementDays,
        usedDays: 0,
        pendingDays: 0,
      });
    } else {
      balance.entitlementDays = dto.entitlementDays;
    }

    const saved = await this.leaveBalances.save(balance);

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'leave.balance_updated',
      entityType: 'leave_balance',
      entityId: saved.id,
      summary: `${actor.email} updated ${leaveType} balance for employee to ${dto.entitlementDays} days (${dto.reason})`,
      metadata: { employeeId, leaveType, entitlementDays: dto.entitlementDays, reason: dto.reason },
    });

    return saved;
  }

  async listLeaveRequests(actor: AuthenticatedUser, employeeId?: string, status?: string) {
    const qb = this.leaveRequests
      .createQueryBuilder('r')
      .leftJoinAndSelect('employees', 'e', 'e.id = r.employee_id');

    if (actor.role === 'admin') {
      if (employeeId) qb.andWhere('r.employeeId = :empId', { empId: employeeId });
    } else if (actor.role === 'manager') {
      const actorEmp = await this.getEmployeeForUser(actor.id);
      let authorizedWarehouseIds: string[] = [];
      if (this.warehouses) {
        authorizedWarehouseIds = await this.warehouses.getUserAuthorizedWarehouseIds(
          actor.id,
          actor.role,
          actor.permissions,
        );
      }

      qb.andWhere(
        '(e.userId = :userId OR e.managerId = :managerEmpId' +
          (authorizedWarehouseIds.length > 0 ? ' OR e.warehouseId IN (:...wIds)' : '') +
          ')',
        {
          userId: actor.id,
          managerEmpId: actorEmp ? actorEmp.id : '00000000-0000-0000-0000-000000000000',
          wIds: authorizedWarehouseIds,
        },
      );
      if (employeeId) qb.andWhere('r.employeeId = :empId', { empId: employeeId });
    } else {
      // Staff / Driver: own requests only
      const ownEmp = await this.getEmployeeForUser(actor.id);
      if (!ownEmp) return [];
      qb.andWhere('r.employeeId = :empId', { empId: ownEmp.id });
    }

    if (status) qb.andWhere('r.status = :status', { status });

    return qb.orderBy('r.submittedAt', 'DESC').getMany();
  }

  async submitLeaveRequest(actor: AuthenticatedUser, dto: SubmitLeaveRequestDto) {
    let targetEmpId = dto.employeeId;
    if (!targetEmpId) {
      const ownEmp = await this.getEmployeeForUserOrFail(actor.id);
      targetEmpId = ownEmp.id;
    } else {
      await this.assertCanAccessEmployee(actor, targetEmpId);
    }

    const currentYear = new Date().getFullYear();
    const balance = await this.leaveBalances.findOne({
      where: { employeeId: targetEmpId, year: currentYear, leaveType: dto.leaveType },
    });

    if (!balance) {
      throw new BadRequestException(`No leave balance configured for ${dto.leaveType}`);
    }

    const remaining = Number(balance.entitlementDays) - Number(balance.usedDays) - Number(balance.pendingDays);
    if (dto.daysCount > remaining) {
      throw new BadRequestException(
        `Insufficient leave days. Requested: ${dto.daysCount}, Available: ${remaining}`,
      );
    }

    // Atomically increment pending_days
    balance.pendingDays = parseFloat((Number(balance.pendingDays) + dto.daysCount).toFixed(2));
    await this.leaveBalances.save(balance);

    const request = await this.leaveRequests.save(
      this.leaveRequests.create({
        id: randomUUID(),
        employeeId: targetEmpId,
        leaveType: dto.leaveType,
        startDate: dto.startDate,
        endDate: dto.endDate,
        daysCount: dto.daysCount,
        reason: dto.reason.trim(),
        status: 'SUBMITTED',
        submittedAt: new Date(),
      }),
    );

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'leave.requested',
      entityType: 'leave_request',
      entityId: request.id,
      summary: `${actor.email} submitted ${dto.leaveType} request for ${dto.daysCount} days (${dto.startDate} to ${dto.endDate})`,
      metadata: { employeeId: targetEmpId, daysCount: dto.daysCount, leaveType: dto.leaveType },
    });

    return request;
  }

  async reviewLeaveRequest(
    actor: AuthenticatedUser,
    requestId: string,
    dto: ReviewLeaveRequestDto,
  ) {
    const request = await this.leaveRequests.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Leave request not found');
    if (request.status !== 'SUBMITTED') {
      throw new ConflictException(`Leave request is already ${request.status}`);
    }

    // Verify manager/admin has authority over this employee
    await this.assertCanAccessEmployee(actor, request.employeeId);

    const currentYear = new Date().getFullYear();
    const balance = await this.leaveBalances.findOne({
      where: { employeeId: request.employeeId, year: currentYear, leaveType: request.leaveType },
    });

    if (dto.status === 'APPROVED') {
      request.status = 'APPROVED';
      request.reviewedBy = actor.id;
      request.reviewedAt = new Date();
      request.reviewComments = dto.comments ?? null;
      await this.leaveRequests.save(request);

      if (balance) {
        balance.pendingDays = Math.max(0, parseFloat((Number(balance.pendingDays) - Number(request.daysCount)).toFixed(2)));
        balance.usedDays = parseFloat((Number(balance.usedDays) + Number(request.daysCount)).toFixed(2));
        await this.leaveBalances.save(balance);
      }

      // Create attendance calendar records for the approved dates
      let cur = request.startDate;
      while (cur <= request.endDate) {
        const existingAtt = await this.attendance.findOne({
          where: { employeeId: request.employeeId, date: cur },
        });
        if (existingAtt) {
          existingAtt.status = 'ON_LEAVE';
          existingAtt.notes = `Approved leave (${request.leaveType})`;
          await this.attendance.save(existingAtt);
        } else {
          await this.attendance.save(
            this.attendance.create({
              id: randomUUID(),
              employeeId: request.employeeId,
              date: cur,
              status: 'ON_LEAVE',
              notes: `Approved leave (${request.leaveType})`,
              source: 'SYSTEM',
              totalHours: 0,
              overtimeHours: 0,
            }),
          );
        }
        cur = addDays(cur, 1);
      }

      await this.audit?.record({
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'leave.approved',
        entityType: 'leave_request',
        entityId: request.id,
        summary: `${actor.email} approved leave request for ${request.daysCount} days (${request.startDate} to ${request.endDate})`,
        metadata: { employeeId: request.employeeId, daysCount: request.daysCount },
      });
    } else {
      // REJECTED
      request.status = 'REJECTED';
      request.reviewedBy = actor.id;
      request.reviewedAt = new Date();
      request.reviewComments = dto.comments ?? null;
      await this.leaveRequests.save(request);

      if (balance) {
        balance.pendingDays = Math.max(0, parseFloat((Number(balance.pendingDays) - Number(request.daysCount)).toFixed(2)));
        await this.leaveBalances.save(balance);
      }

      await this.audit?.record({
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'leave.rejected',
        entityType: 'leave_request',
        entityId: request.id,
        summary: `${actor.email} rejected leave request for ${request.daysCount} days`,
        metadata: { employeeId: request.employeeId, reason: dto.comments },
      });
    }

    return request;
  }

  async cancelLeaveRequest(actor: AuthenticatedUser, requestId: string) {
    const request = await this.leaveRequests.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Leave request not found');
    if (request.status !== 'SUBMITTED') {
      throw new ConflictException(`Cannot cancel a leave request with status "${request.status}"`);
    }

    const ownEmp = await this.getEmployeeForUser(actor.id);
    if (actor.role !== 'admin' && (!ownEmp || ownEmp.id !== request.employeeId)) {
      throw new ForbiddenException('You can only cancel your own submitted leave requests');
    }

    request.status = 'CANCELLED';
    await this.leaveRequests.save(request);

    const currentYear = new Date().getFullYear();
    const balance = await this.leaveBalances.findOne({
      where: { employeeId: request.employeeId, year: currentYear, leaveType: request.leaveType },
    });
    if (balance) {
      balance.pendingDays = Math.max(0, parseFloat((Number(balance.pendingDays) - Number(request.daysCount)).toFixed(2)));
      await this.leaveBalances.save(balance);
    }

    await this.audit?.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'leave.cancelled',
      entityType: 'leave_request',
      entityId: request.id,
      summary: `${actor.email} cancelled leave request for ${request.daysCount} days`,
    });

    return request;
  }
}
