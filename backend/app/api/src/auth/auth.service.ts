import {
  ConflictException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AuditService } from '../audit/audit.service';
import { DIVISION_LABELS } from '../divisions/divisions.constants';
import { DivisionsService } from '../divisions/divisions.service';
import { RedisService } from '../redis/redis.service';
import { RolesService } from '../roles/roles.service';
import { UsersService } from '../users/users.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { RegisterDto } from './dto/register.dto';
import { SessionService } from './session.service';

const BCRYPT_ROUNDS = 12;
// Precomputed bcrypt(12) hash for timing attack protection when email is not found
const DUMMY_BCRYPT_HASH =
  '$2b$12$But4KfPaAVBzdTco0Ep7du/MdY/T3gMcr8zzDb04XtvnoIY9570ie';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class AuthService {
  private resolvedSessionService: SessionService;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private auditService: AuditService,
    private rolesService: RolesService,
    private warehousesService: WarehousesService,
    @Optional() private divisionsService?: DivisionsService,
    @Optional() private sessionService?: SessionService,
  ) {
    this.resolvedSessionService =
      this.sessionService ||
      new SessionService({
        getClient: () => null,
      } as unknown as RedisService);
  }

  /**
   * Bootstrap path only. Rejected once any user exists — this is not a
   * general-purpose signup endpoint.
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

    const permissions = await this.rolesService.getPermissionsForRole(
      user.role,
    );
    const hasGlobalAccess = permissions.includes('warehouses:global_access');
    const warehouses = await this.warehousesService.getUserAuthorizedWarehouses(
      user.id,
      user.role,
      permissions,
    );
    const divisions = this.divisionsService
      ? await this.divisionsService.getUserDivisions(user.id)
      : [];

    const session = await this.resolvedSessionService.createSession({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      sessionId: session.id,
      csrfToken: session.csrfToken,
      access_token: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        permissions,
        warehouses,
        divisions: divisions.map((key) => ({
          key,
          label: DIVISION_LABELS[key] || key,
        })),
        hasGlobalAccess,
      },
    };
  }

  async login(
    rawEmail: string,
    password: string,
    meta?: { ip?: string; userAgent?: string },
  ) {
    const email = normalizeEmail(rawEmail);
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      // Execute constant-time bcrypt verification to mitigate timing attacks/account enumeration
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status && user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (typeof this.usersService.recordLogin === 'function') {
      await this.usersService.recordLogin(user.id);
    }

    const permissions = await this.rolesService.getPermissionsForRole(
      user.role,
    );
    const hasGlobalAccess = permissions.includes('warehouses:global_access');
    const warehouses = await this.warehousesService.getUserAuthorizedWarehouses(
      user.id,
      user.role,
      permissions,
    );
    const divisions = this.divisionsService
      ? await this.divisionsService.getUserDivisions(user.id)
      : [];

    // Create opaque server session
    const session = await this.resolvedSessionService.createSession(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      meta,
    );

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
      sessionId: session.id,
      csrfToken: session.csrfToken,
      access_token: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status ?? 'active',
        permissions,
        warehouses,
        divisions: divisions.map((key) => ({
          key,
          label: DIVISION_LABELS[key] || key,
        })),
        hasGlobalAccess,
      },
    };
  }

  async logout(sessionId?: string): Promise<void> {
    if (sessionId) {
      await this.resolvedSessionService.invalidateSession(sessionId);
    }
  }
}
