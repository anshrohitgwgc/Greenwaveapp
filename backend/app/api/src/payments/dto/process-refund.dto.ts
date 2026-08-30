import { IsOptional, IsString } from 'class-validator';

export class ProcessRefundDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
