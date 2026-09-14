import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Optional,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

interface RequestWithCookies extends Request {
  cookies: Record<string, string>;
}

function parseCookies(header?: string): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx !== -1) {
      cookies[part.slice(0, idx).trim()] = decodeURIComponent(
        part.slice(idx + 1).trim(),
      );
    }
  }
  return cookies;
}

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    @Optional() private rateLimitGuard?: LoginRateLimitGuard,
  ) {}

  @Post('register')
  register() {
    throw new ForbiddenException(
      'Public registration is disabled. Staff accounts must be created by an administrator.',
    );
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LoginRateLimitGuard)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip =
      (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req?.ip ||
      '127.0.0.1';
    const userAgent = req?.headers?.['user-agent'];

    const result = await this.authService.login(dto.email, dto.password, {
      ip,
      userAgent,
    });

    // Reset rate limit on successful authentication
    if (
      this.rateLimitGuard &&
      typeof this.rateLimitGuard.resetLimit === 'function'
    ) {
      await this.rateLimitGuard.resetLimit(ip, dto.email);
    }

    const isProduction = process.env.NODE_ENV === 'production';

    // 1. Set HttpOnly, Secure, SameSite=Lax session cookie
    if (res && typeof res.cookie === 'function') {
      res.cookie('gw_session', result.sessionId, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 86400 * 1000, // 24 hours
      });

      // 2. Set readable CSRF cookie for client-side inclusion in X-CSRF-Token header
      res.cookie('gw_csrf', result.csrfToken, {
        httpOnly: false,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 86400 * 1000,
      });
    }

    return {
      access_token: result.access_token,
      csrfToken: result.csrfToken,
      user: result.user,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const reqWithCookies = req as RequestWithCookies;
    const cookies =
      reqWithCookies?.cookies || parseCookies(req?.headers?.cookie);
    const sessionId: string | undefined = cookies?.['gw_session'];

    if (sessionId) {
      await this.authService.logout(sessionId);
    }

    const isProduction = process.env.NODE_ENV === 'production';

    if (res && typeof res.clearCookie === 'function') {
      res.clearCookie('gw_session', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
      });
      res.clearCookie('gw_csrf', {
        path: '/',
        httpOnly: false,
        sameSite: 'lax',
        secure: isProduction,
      });
    }

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() actor: AuthenticatedUser) {
    const profile = await this.usersService.getUserProfile(actor.id);
    if (!profile) {
      return null;
    }
    // Return presentation-safe fields only (no hashes, no secrets)
    return {
      id: profile.id,
      fullName: profile.fullName,
      email: profile.email,
      role: profile.role,
      status: profile.status,
      permissions: profile.permissions,
      warehouses: profile.warehouses,
      divisions: profile.divisions,
      hasGlobalAccess: profile.hasGlobalAccess,
      lastLoginAt: profile.lastLoginAt,
      createdAt: profile.createdAt,
    };
  }
}
