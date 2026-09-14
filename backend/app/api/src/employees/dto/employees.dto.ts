import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateEmployeeDto {
  @IsString() @MinLength(2) @MaxLength(32) employeeId: string;
  @IsOptional() @IsInt() userId?: number;
  @IsString() @MinLength(1) @MaxLength(64) firstName: string;
  @IsString() @MinLength(1) @MaxLength(64) lastName: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsString() @MinLength(1) @MaxLength(64) department: string;
  @IsString() @MinLength(1) @MaxLength(64) position: string;
  @Matches(ISO_DATE) startDate: string;
  @IsOptional() @Matches(ISO_DATE) endDate?: string;
  @IsOptional() @IsIn(['ACTIVE', 'PROBATION', 'SUSPENDED', 'TERMINATED', 'ON_LEAVE']) status?: 'ACTIVE' | 'PROBATION' | 'SUSPENDED' | 'TERMINATED' | 'ON_LEAVE';
  @IsOptional() @IsIn(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'SEASONAL']) employmentType?: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'SEASONAL';
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) lastName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) department?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) position?: string;
  @IsOptional() @Matches(ISO_DATE) startDate?: string;
  @IsOptional() @Matches(ISO_DATE) endDate?: string;
  @IsOptional() @IsIn(['ACTIVE', 'PROBATION', 'SUSPENDED', 'TERMINATED', 'ON_LEAVE']) status?: 'ACTIVE' | 'PROBATION' | 'SUSPENDED' | 'TERMINATED' | 'ON_LEAVE';
  @IsOptional() @IsIn(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'SEASONAL']) employmentType?: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'SEASONAL';
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
}

export class ListEmployeesQueryDto {
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsIn(['ACTIVE', 'PROBATION', 'SUSPENDED', 'TERMINATED', 'ON_LEAVE']) status?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class RecordAttendanceDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @Matches(ISO_DATE) date: string;
  @IsOptional() @IsString() clockIn?: string;
  @IsOptional() @IsString() clockOut?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(24) totalHours?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(24) overtimeHours?: number;
  @IsOptional() @IsIn(['PRESENT', 'ABSENT', 'LATE', 'REMOTE', 'HALF_DAY', 'ON_LEAVE']) status?: 'PRESENT' | 'ABSENT' | 'LATE' | 'REMOTE' | 'HALF_DAY' | 'ON_LEAVE';
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class ListAttendanceQueryDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @Matches(ISO_DATE) from?: string;
  @IsOptional() @Matches(ISO_DATE) to?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsIn(['PRESENT', 'ABSENT', 'LATE', 'REMOTE', 'HALF_DAY', 'ON_LEAVE']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class SubmitLeaveRequestDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsIn(['VACATION', 'SICK', 'PERSONAL', 'OTHER']) leaveType: 'VACATION' | 'SICK' | 'PERSONAL' | 'OTHER';
  @Matches(ISO_DATE) startDate: string;
  @Matches(ISO_DATE) endDate: string;
  @IsNumber() @IsPositive() @Max(365) daysCount: number;
  @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class ReviewLeaveRequestDto {
  @IsIn(['APPROVED', 'REJECTED']) status: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @MaxLength(1000) comments?: string;
}

export class UpdateLeaveBalanceDto {
  @IsNumber() @Min(0) @Max(365) entitlementDays: number;
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}
