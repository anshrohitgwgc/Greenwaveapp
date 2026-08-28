import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Bootstrap-only. No `role` field exists here on purpose — a caller cannot
 * request a privileged role. AuthService additionally refuses this endpoint
 * once any user already exists, so it only ever creates the very first
 * (administrator) account.
 */
export class RegisterDto {
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
}
