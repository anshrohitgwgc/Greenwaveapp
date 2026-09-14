import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
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
import { EmployeesService } from './employees.service';
import type { LeaveType } from './entities/leave-balance.entity';

@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  // --------------------------------------------------------------------------
  // Employees
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermissions('employees:read')
  listEmployees(@CurrentUser() actor: AuthenticatedUser, @Query() q: ListEmployeesQueryDto) {
    return this.employeesService.listEmployees(actor, q);
  }

  @Get('me')
  @RequirePermissions('employees:read')
  getMe(@CurrentUser() actor: AuthenticatedUser) {
    return this.employeesService.getEmployeeForUserOrFail(actor.id);
  }

  @Get('attendance')
  @RequirePermissions('attendance:read')
  listAttendance(@CurrentUser() actor: AuthenticatedUser, @Query() q: ListAttendanceQueryDto) {
    return this.employeesService.listAttendance(actor, q);
  }

  @Post('attendance')
  @RequirePermissions('attendance:write')
  recordAttendance(@CurrentUser() actor: AuthenticatedUser, @Body() dto: RecordAttendanceDto) {
    return this.employeesService.recordAttendance(actor, dto);
  }

  @Get('leave-requests')
  @RequirePermissions('leave:read')
  listLeaveRequests(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ) {
    return this.employeesService.listLeaveRequests(actor, employeeId, status);
  }

  @Post('leave-requests')
  @RequirePermissions('leave:request')
  submitLeaveRequest(@CurrentUser() actor: AuthenticatedUser, @Body() dto: SubmitLeaveRequestDto) {
    return this.employeesService.submitLeaveRequest(actor, dto);
  }

  @Post('leave-requests/:id/review')
  @Roles('admin', 'manager')
  @RequirePermissions('leave:manage')
  reviewLeaveRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ReviewLeaveRequestDto,
  ) {
    return this.employeesService.reviewLeaveRequest(actor, id, dto);
  }

  @Post('leave-requests/:id/cancel')
  @RequirePermissions('leave:request')
  cancelLeaveRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.employeesService.cancelLeaveRequest(actor, id);
  }

  @Get(':id')
  @RequirePermissions('employees:read')
  getEmployee(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.employeesService.getEmployee(actor, id);
  }

  @Post()
  @Roles('admin')
  @RequirePermissions('employees:manage')
  createEmployee(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.createEmployee(actor, dto);
  }

  @Patch(':id')
  @Roles('admin')
  @RequirePermissions('employees:manage')
  updateEmployee(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.updateEmployee(actor, id, dto);
  }

  @Get(':id/leave-balances')
  @RequirePermissions('leave:read')
  getLeaveBalances(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query('year') year?: number,
  ) {
    return this.employeesService.getLeaveBalances(actor, id, year ? Number(year) : undefined);
  }

  @Patch(':id/leave-balances/:leaveType')
  @Roles('admin')
  @RequirePermissions('leave:manage')
  updateLeaveBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('leaveType') leaveType: LeaveType,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateLeaveBalanceDto,
    @Query('year') year?: number,
  ) {
    return this.employeesService.updateLeaveBalance(actor, id, leaveType, dto, year ? Number(year) : undefined);
  }
}
