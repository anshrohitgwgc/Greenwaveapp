import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import {
  Between,
  FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { WarehousesService } from '../warehouses/warehouses.service';
import { ClockInDto } from './dto/clock-in.dto';
import { Timesheet } from './entities/timesheet.entity';

@Injectable()
export class TimesheetsService {
  constructor(
    @InjectRepository(Timesheet)
    private readonly timesheetRepository: Repository<Timesheet>,
    private readonly auditService: AuditService,
    private readonly warehousesService: WarehousesService,
  ) {}

  async clockIn(dto: ClockInDto, actor: AuthenticatedUser) {
    if (dto.warehouseId) {
      await this.warehousesService.assertWarehouseAccess(
        actor,
        dto.warehouseId,
      );
    }

    const active = await this.timesheetRepository.findOne({
      where: { userId: actor.id, clockOut: IsNull() },
    });
    if (active) {
      throw new ConflictException('Already clocked in — clock out first');
    }

    const shift = this.timesheetRepository.create({
      id: randomUUID(),
      userId: actor.id,
      warehouseId: dto.warehouseId ?? null,
      clockIn: new Date(),
      clockOut: null,
    });
    const saved = await this.timesheetRepository.save(shift);

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'timesheet.clock_in',
      entityType: 'timesheet',
      entityId: saved.id,
      warehouseId: saved.warehouseId,
      summary: `${actor.email} clocked in`,
    });

    return saved;
  }

  async clockOut(actor: AuthenticatedUser) {
    const active = await this.timesheetRepository.findOne({
      where: { userId: actor.id, clockOut: IsNull() },
    });
    if (!active) {
      throw new NotFoundException('No active shift to clock out of');
    }

    active.clockOut = new Date();
    const saved = await this.timesheetRepository.save(active);

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'timesheet.clock_out',
      entityType: 'timesheet',
      entityId: saved.id,
      warehouseId: saved.warehouseId,
      summary: `${actor.email} clocked out`,
    });

    return saved;
  }

  currentShift(actorId: number) {
    return this.timesheetRepository.findOne({
      where: { userId: actorId, clockOut: IsNull() },
    });
  }

  history(actorId: number, from?: Date, to?: Date) {
    const where: FindOptionsWhere<Timesheet> = { userId: actorId };
    if (from && to) {
      where.clockIn = Between(from, to);
    } else if (from) {
      where.clockIn = MoreThanOrEqual(from);
    } else if (to) {
      where.clockIn = LessThanOrEqual(to);
    }
    return this.timesheetRepository.find({
      where,
      order: { clockIn: 'DESC' },
    });
  }

  /** MANAGER/ADMIN only */
  async teamStatus(actor: AuthenticatedUser) {
    if (
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
        return this.timesheetRepository.find({
          where: { clockOut: IsNull(), warehouseId: IsNull() },
          order: { clockIn: 'DESC' },
        });
      }
      return this.timesheetRepository.find({
        where: [
          { clockOut: IsNull(), warehouseId: In(authorizedIds) },
          { clockOut: IsNull(), warehouseId: IsNull() },
        ],
        order: { clockIn: 'DESC' },
      });
    }

    return this.timesheetRepository.find({
      where: { clockOut: IsNull() },
      order: { clockIn: 'DESC' },
    });
  }
}
