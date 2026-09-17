import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { MAX_INVENTORY_PHOTOS } from '../../common/photo-limits';

export class AttachInventoryPhotosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INVENTORY_PHOTOS)
  @IsUUID('4', { each: true })
  photoIds: string[];
}
