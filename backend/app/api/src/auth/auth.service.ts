import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_ROUNDS = 12;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sanitizeUser(user: {
  id: number;
  fullName: string;
  email: string;
  role: string;
}) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private auditService: AuditService,
  ) {}

  /**
   * Bootstrap path only. Rejected once any user exists — this is not a
   * general-purpose signup endpoint, and it never trusts a caller-supplied
   * role (RegisterDto has no role field at all).
   */
  async register(dto: RegisterDto) {
    const existingUserCount = await this.usersService.count();
    if (existingUserCount > 0) {
      throw new ConflictException(
        'Registration is closed. Ask an administrator to create your account.',
      );
    }

    const email = normalizeEmail(dto.email);
    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.usersService.create({
      fullName: dto.fullName,
      email,
      password: hashedPassword,
      role: 'admin',
    });

    await this.auditService.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.bootstrap_admin_created',
      entityType: 'user',
      entityId: String(user.id),
      summary: `First-run bootstrap created administrator account ${email}`,
    });

    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: await this.jwtService.signAsync(payload),
      user: sanitizeUser(user),
    };
  }

  async login(rawEmail: string, password: string) {
    const email = normalizeEmail(rawEmail);
    const user = await this.usersService.findByEmail(email);

    // Same generic message whether the email is unknown or the password is
    // wrong — do not let the login endpoint be used to enumerate accounts.
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    await this.auditService.record({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.login',
      entityType: 'user',
      entityId: String(user.id),
      summary: `${email} signed in`,
    });

    return {
      access_token: await this.jwtService.signAsync(payload),
      user: sanitizeUser(user),
    };
  }
}
