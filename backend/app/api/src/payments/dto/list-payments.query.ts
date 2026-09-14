import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

import { PAYMENT_STATUSES } from '../payment-status';

export class ListPaymentsQueryDto {
  @IsOptional()
  @IsIn([...PAYMENT_STATUSES])
  status?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z_]{2,48}$/)
  method?: string;

  @IsOptional()
  @IsIn(['CAD', 'USD'])
  currency?: string;

  /** Payment date range, business-calendar days, inclusive. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  /** Invoice number, customer name, GreenWave payment id, or Stripe id. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class PaymentSummaryQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @IsOptional()
  @IsIn(['CAD', 'USD'])
  currency?: string;
}
