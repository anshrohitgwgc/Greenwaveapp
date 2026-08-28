import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RolesGuard } from './roles.guard';

function makeContext(
  user: { role?: string } | undefined,
  required: string[] | undefined,
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;

  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;

  return { guard: new RolesGuard(reflector), context };
}

describe('RolesGuard', () => {
  it('allows the request when no roles are required', () => {
    const { guard, context } = makeContext({ role: 'staff' }, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a matching role', () => {
    const { guard, context } = makeContext({ role: 'admin' }, [
      'admin',
      'manager',
    ]);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies a non-matching role', () => {
    const { guard, context } = makeContext({ role: 'staff' }, [
      'admin',
      'manager',
    ]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('denies when there is no authenticated user', () => {
    const { guard, context } = makeContext(undefined, ['admin']);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('treats driver as staff-tier for routes that allow staff', () => {
    const { guard, context } = makeContext({ role: 'driver' }, ['staff']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('does not let driver reach admin-only routes', () => {
    const { guard, context } = makeContext({ role: 'driver' }, ['admin']);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
