import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UploadPhotoMetadataDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  jobReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  photoType?: string;
}
