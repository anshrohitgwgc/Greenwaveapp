import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

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
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
