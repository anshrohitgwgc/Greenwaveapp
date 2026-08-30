import { IsEmail, IsOptional, IsString } from 'class-validator';

export class SendInvoiceEmailDto {
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @IsOptional()
  @IsString()
  customMessage?: string;
}
