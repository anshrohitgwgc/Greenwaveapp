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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX = Number.MAX_SAFE_INTEGER;

export class CreateFinancialAccountDto {
  @IsIn(['BANK', 'CREDIT_CARD']) kind: 'BANK' | 'CREDIT_CARD';
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(120) institution?: string;
  @IsOptional() @Matches(/^\d{4}$/, { message: 'accountMask must be exactly the last 4 digits' }) accountMask?: string;
  @IsIn(['CHEQUING', 'SAVINGS', 'CREDIT_CARD', 'LINE_OF_CREDIT']) accountType: string;
  @IsIn(['CAD', 'USD']) currency: string;
  @IsOptional() @IsUUID() ledgerAccountId?: string;
  @IsOptional() @IsBoolean() createLedgerAccount?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(MAX) creditLimitMinor?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) statementDay?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) paymentDueDay?: number;
}

export class UpdateFinancialAccountDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(120) institution?: string;
  @IsOptional() @Matches(/^\d{4}$/, { message: 'accountMask must be exactly the last 4 digits' }) accountMask?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX) creditLimitMinor?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) statementDay?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) paymentDueDay?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ListTransactionsQueryDto {
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsIn(['UNREVIEWED', 'CATEGORIZED', 'MATCHED', 'RECONCILED', 'EXCLUDED']) status?: string;
  @IsOptional() @IsIn(['DEBIT', 'CREDIT']) direction?: string;
  @IsOptional() @Matches(ISO_DATE) from?: string;
  @IsOptional() @Matches(ISO_DATE) to?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class StatementMappingDto {
  @IsBoolean() hasHeader: boolean;
  @IsString() @MinLength(1) @MaxLength(100) dateColumn: string;
  @IsOptional() @IsString() @MaxLength(100) postedDateColumn?: string;
  @IsString() @MinLength(1) @MaxLength(100) descriptionColumn: string;
  @IsOptional() @IsString() @MaxLength(100) merchantColumn?: string;
  @IsOptional() @IsString() @MaxLength(100) amountColumn?: string;
  @IsOptional() @IsString() @MaxLength(100) debitColumn?: string;
  @IsOptional() @IsString() @MaxLength(100) creditColumn?: string;
  @IsOptional() @IsIn(['NEGATIVE_IS_DEBIT', 'POSITIVE_IS_DEBIT']) amountSign?: 'NEGATIVE_IS_DEBIT' | 'POSITIVE_IS_DEBIT';
  @IsOptional() @IsString() @MaxLength(100) externalIdColumn?: string;
  @IsOptional() @IsString() @MaxLength(100) currencyColumn?: string;
  @IsIn(['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY']) dateFormat: 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY';
}

export class ImportPreviewBodyDto {
  @IsUUID() accountId: string;
  /** JSON-encoded StatementMappingDto (multipart form field). */
  @IsString() @MaxLength(4000) mapping: string;
}

export class ImportRowsQueryDto {
  @IsOptional() @IsIn(['VALID', 'DUPLICATE', 'ERROR']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class SplitDto {
  @IsUUID() accountId: string;
  @IsInt() @Min(1) @Max(MAX) amountMinor: number;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
}

export class CategorizeDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SplitDto)
  splits: SplitDto[];
  @IsOptional() @IsString() @MaxLength(1000) memo?: string;
}

export class MatchDto {
  @IsIn(['PAYOUT', 'BILL', 'TRANSFER', 'JOURNAL_ENTRY']) type: 'PAYOUT' | 'BILL' | 'TRANSFER' | 'JOURNAL_ENTRY';
  @IsString() @MinLength(1) @MaxLength(128) targetId: string;
}

export class ExcludeDto {
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class StartReconciliationDto {
  @IsUUID() accountId: string;
  @Matches(ISO_DATE) statementEndDate: string;
  @IsInt() @Min(-MAX) @Max(MAX) statementEndingBalanceMinor: number;
  /** Only for an account's first reconciliation; later ones start from the previous ending balance. */
  @IsOptional() @IsInt() @Min(-MAX) @Max(MAX) openingBalanceMinor?: number;
}

export class CompleteReconciliationDto {
  @IsArray() @ArrayMaxSize(5000) @IsUUID('all', { each: true }) clearedTransactionIds: string[];
}
