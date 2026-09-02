import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const ASSIGNABLE_ROLES = [
  'admin',
  'manager',
  'staff',
  'driver',
] as const;

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'password must contain at least one uppercase letter, one lowercase letter and one number',
  })
  password: string;

  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES)
  role?: (typeof ASSIGNABLE_ROLES)[number];

  @IsOptional()
  @IsIn(['active', 'inactive', 'suspended'])
  status?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  warehouseIds?: string[];

  /**
   * Business divisions to grant. Omitted or empty means **no division
   * access** — the deliberate default for every new account. There is no
   * implicit GreenWave grant.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(['greenwave', 'healthcare'], { each: true })
  divisions?: string[];
}
