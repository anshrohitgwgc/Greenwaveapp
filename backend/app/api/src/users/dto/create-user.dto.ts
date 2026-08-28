import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
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
}
