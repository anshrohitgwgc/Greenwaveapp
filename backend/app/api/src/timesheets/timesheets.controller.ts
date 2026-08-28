import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ClockInDto } from './dto/clock-in.dto';
import { TimesheetsService } from './timesheets.service';

@Controller('timesheets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TimesheetsController {
  constructor(private readonly timesheetsService: TimesheetsService) {}

  @Post('clock-in')
  clockIn(@Body() dto: ClockInDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.timesheetsService.clockIn(dto, actor);
  }

  @Post('clock-out')
  clockOut(@CurrentUser() actor: AuthenticatedUser) {
    return this.timesheetsService.clockOut(actor);
  }

  @Get('me/current')
  current(@CurrentUser() actor: AuthenticatedUser) {
    return this.timesheetsService.currentShift(actor.id);
  }

  @Get('me/history')
  history(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.timesheetsService.history(
      actor.id,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  // Staff cannot view unauthorized staff information — team status is
  // manager/admin only.
  @Get('team')
  @Roles('admin', 'manager')
  team() {
    return this.timesheetsService.teamStatus();
  }
}
