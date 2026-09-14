import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateVendorDto {
  @IsString() @MinLength(2) @MaxLength(160) name: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(64) phone?: string;
  @IsOptional() @IsUUID() defaultExpenseAccountId?: string;
}

export class UpdateVendorDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) name?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(64) phone?: string;
  @IsOptional() @IsUUID() defaultExpenseAccountId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateBillDto {
  @IsUUID() vendorId: string;
  @IsString() @MinLength(1) @MaxLength(64) billNumber: string;
  @Matches(ISO_DATE) billDate: string;
  @IsOptional() @Matches(ISO_DATE) dueDate?: string;
  @IsIn(['CAD', 'USD']) currency: string;
  @IsUUID() expenseAccountId: string;
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) subtotalMinor: number;
  @IsOptional() @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) taxMinor?: number;
  @IsOptional() @IsUUID() purchaseOrderId?: string;
  @IsOptional() @IsString() @MaxLength(2000) memo?: string;
}

export class ListBillsQueryDto {
  @IsOptional() @IsIn(['DRAFT', 'OPEN', 'PAID', 'VOID']) status?: string;
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class PayablesAgingQueryDto {
  @IsOptional() @Matches(ISO_DATE) asOf?: string;
  @IsOptional() @IsIn(['CAD', 'USD']) currency?: string;
}
