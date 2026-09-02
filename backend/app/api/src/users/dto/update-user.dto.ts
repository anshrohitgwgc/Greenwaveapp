import { PartialType, OmitType } from '@nestjs/mapped-types';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';

import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password'] as const),
) {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  warehouseIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(['greenwave', 'healthcare'], { each: true })
  divisions?: string[];
}
