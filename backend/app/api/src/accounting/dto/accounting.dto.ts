import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { ACCOUNT_TYPES } from '../chart-of-accounts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class RangeQueryDto {
  @Matches(ISO_DATE) from: string;
  @Matches(ISO_DATE) to: string;
  @IsOptional() @IsIn(['CAD', 'USD']) currency?: string;
  @IsOptional() @Matches(ISO_DATE) compareFrom?: string;
  @IsOptional() @Matches(ISO_DATE) compareTo?: string;
}

export class AsOfQueryDto {
  @IsOptional() @Matches(ISO_DATE) asOf?: string;
  @IsOptional() @IsIn(['CAD', 'USD']) currency?: string;
}

export class GeneralLedgerQueryDto {
  @IsUUID() accountId: string;
  @Matches(ISO_DATE) from: string;
  @Matches(ISO_DATE) to: string;
  @IsOptional() @IsIn(['CAD', 'USD']) currency?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize?: number;
}

export class AccountsQueryDto {
  @IsOptional() @IsIn(['true', 'false']) includeInactive?: string;
  @IsOptional() @Matches(ISO_DATE) asOf?: string;
  @IsOptional() @IsIn(['CAD', 'USD']) currency?: string;
}

export class JournalListQueryDto {
  @IsOptional() @Matches(ISO_DATE) from?: string;
  @IsOptional() @Matches(ISO_DATE) to?: string;
  @IsOptional() @Matches(/^[a-z_]{2,48}$/) sourceType?: string;
  @IsOptional() @IsIn(['DRAFT', 'POSTED', 'REVERSED']) status?: string;
  @IsOptional() @IsIn(['CAD', 'USD']) currency?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class CreateLedgerAccountDto {
  @Matches(/^[0-9A-Za-z-]{2,16}$/) code: string;
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsIn([...ACCOUNT_TYPES]) type: string;
  @IsOptional() @Matches(/^[A-Z_]{2,40}$/) subtype?: string;
  @IsOptional() @IsIn(['DEBIT', 'CREDIT']) normalBalance?: 'DEBIT' | 'CREDIT';
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateLedgerAccountDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @Matches(/^[A-Z_]{2,40}$/) subtype?: string;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ManualEntryLineDto {
  @IsUUID() accountId: string;
  @IsOptional() @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) debitMinor?: number;
  @IsOptional() @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) creditMinor?: number;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
}

export class CreateManualEntryDto {
  @Matches(ISO_DATE) entryDate: string;
  @IsString() @MinLength(3) @MaxLength(255) description: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsIn(['CAD', 'USD']) currency: string;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ManualEntryLineDto)
  lines: ManualEntryLineDto[];
  @IsOptional() @IsBoolean() post?: boolean;
}

export class ReverseEntryDto {
  @Matches(ISO_DATE) entryDate: string;
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}
