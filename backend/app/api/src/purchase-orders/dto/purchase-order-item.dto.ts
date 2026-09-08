import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PurchaseOrderItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  resin?: string;

  @IsString()
  @MinLength(1, { message: 'Each line item needs a description' })
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  color?: string;

  /**
   * Must be strictly positive: a zero-quantity line contributes nothing to the
   * order and is almost always an unfinished row the user forgot to remove.
   * `maxDecimalPlaces` matches NUMERIC(14,3) in migration 018.
   */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001, { message: 'Quantity must be greater than 0' })
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  unit?: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0, { message: 'Unit price cannot be negative' })
  unitPrice: number;

  // NOTE: there is deliberately no `amount` field. The line amount is always
  // recomputed from quantity x unitPrice server-side, so a client cannot
  // supply one. With ValidationPipe({ whitelist, forbidNonWhitelisted }) an
  // attempt to send one is rejected outright rather than silently dropped.
}
