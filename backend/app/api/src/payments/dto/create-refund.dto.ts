import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateRefundDto {
  /** Omit for a full refund of the remaining refundable amount. Minor units. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amountMinor?: number;

  @IsOptional()
  @IsIn(['duplicate', 'fraudulent', 'requested_by_customer'])
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
