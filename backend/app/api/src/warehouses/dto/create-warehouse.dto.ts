import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateWarehouseDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @MaxLength(32)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  province?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
