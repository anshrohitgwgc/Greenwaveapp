import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

// class-validator's @IsOptional() only skips validation for null/undefined,
// not an empty string — the Add/Edit Customer form submits '' for a blank
// field via FormData, which would otherwise fail @IsEmail()/@IsUUID() on a
// field the UI (and this DTO's @IsOptional()) both intend to be skippable.
const emptyStringToUndefined = Transform(({ value }: { value: unknown }) =>
  value === '' ? undefined : value,
);

export class CreateCustomerDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsObject()
  companyInfo?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  billTo?: string;

  @IsOptional()
  @IsString()
  shipTo?: string;

  @IsOptional()
  @emptyStringToUndefined
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string;

  @IsOptional()
  @emptyStringToUndefined
  @IsUUID()
  warehouseId?: string;

  /**
   * Business division. Optional on the wire: a user who holds exactly one
   * division does not have to restate it. It is never defaulted for a user
   * who holds several — the service rejects that with a 400.
   */
  @IsOptional()
  @emptyStringToUndefined
  @IsIn(['greenwave', 'recycling', 'healthcare'])
  division?: string;
}
