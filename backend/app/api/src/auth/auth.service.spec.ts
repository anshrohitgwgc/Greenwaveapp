import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';

import { AuditService } from '../audit/audit.service';
import { RolesService } from '../roles/roles.service';
import { UsersService } from '../users/users.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findByEmail: jest.Mock;
    create: jest.Mock;
    count: jest.Mock;
    recordLogin: jest.Mock;
  };
  let auditService: { record: jest.Mock };
  let rolesService: { getPermissionsForRole: jest.Mock };
  let warehousesService: { getUserAuthorizedWarehouses: jest.Mock };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      recordLogin: jest.fn().mockResolvedValue(undefined),
    };
    auditService = { record: jest.fn() };
    rolesService = {
      getPermissionsForRole: jest.fn().mockResolvedValue(['inventory:write']),
    };
    warehousesService = {
      getUserAuthorizedWarehouses: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: AuditService, useValue: auditService },
        { provide: RolesService, useValue: rolesService },
        { provide: WarehousesService, useValue: warehousesService },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn().mockResolvedValue('mock_jwt_token'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('rejects an unknown email with a generic message', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login('nobody@example.com', 'whatever'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.login('nobody@example.com', 'whatever'),
      ).rejects.toThrow('Invalid credentials');
    });

    it('rejects a wrong password with the same generic message', async () => {
      const hash = await bcrypt.hash('correct-password', 12);
      usersService.findByEmail.mockResolvedValue({
        id: 1,
        email: 'staff@example.com',
        password: hash,
        role: 'staff',
        fullName: 'Staff Person',
      });

      await expect(
        service.login('staff@example.com', 'wrong-password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('logs in with the correct password and returns a token without the password hash', async () => {
      const hash = await bcrypt.hash('correct-password', 12);
      usersService.findByEmail.mockResolvedValue({
        id: 1,
        email: 'staff@example.com',
        password: hash,
        role: 'staff',
        fullName: 'Staff Person',
      });

      const result = await service.login(
        'STAFF@Example.com ',
        'correct-password',
      );

      expect(result.access_token).toBe('mock_jwt_token');
      expect(result.user).toEqual(
        expect.objectContaining({
          id: 1,
          fullName: 'Staff Person',
          email: 'staff@example.com',
          role: 'staff',
        }),
      );
      expect((result.user as Record<string, unknown>).password).toBeUndefined();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login' }),
      );
    });
  });

  describe('register (bootstrap only)', () => {
    it('creates the first account as admin, ignoring any caller-supplied role', async () => {
      usersService.count.mockResolvedValue(0);
      usersService.create.mockResolvedValue({
        id: 1,
        fullName: 'First Admin',
        email: 'first@example.com',
        role: 'admin',
      });

      const result = await service.register({
        fullName: 'First Admin',
        email: 'first@example.com',
        password: 'Password1',
      });

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin' }),
      );
      expect(result.user.role).toBe('admin');
    });

    it('refuses to bootstrap again once a user already exists', async () => {
      usersService.count.mockResolvedValue(1);

      await expect(
        service.register({
          fullName: 'Second Person',
          email: 'second@example.com',
          password: 'Password1',
        }),
      ).rejects.toThrow(ConflictException);
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });
});
