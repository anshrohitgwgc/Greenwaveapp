import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditService } from './audit.service';
import { AuditEvent } from './entities/audit-event.entity';

describe('AuditService', () => {
  let service: AuditService;
  let repo: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    repo = {
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((data: Record<string, unknown>) => Promise.resolve(data)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditEvent), useValue: repo },
      ],
    }).compile();

    service = module.get(AuditService);
  });

  it('strips password/token-shaped keys out of metadata before saving', async () => {
    const saved = await service.record({
      actorUserId: 1,
      actorRole: 'admin',
      action: 'auth.login',
      entityType: 'user',
      entityId: '1',
      summary: 'test',
      metadata: {
        password: 'plaintext-should-never-be-here',
        access_token: 'jwt-should-never-be-here',
        token: 'also-should-never-be-here',
        safeField: 'kept',
      },
    });

    expect(saved.metadata).toEqual({ safeField: 'kept' });
  });

  it('never includes a password/token key even if casing differs', async () => {
    const saved = await service.record({
      actorUserId: 1,
      actorRole: 'admin',
      action: 'x',
      entityType: 'y',
      summary: 'z',
      metadata: { Password: 'x', ACCESS_TOKEN: 'y' },
    });

    expect(Object.keys(saved.metadata ?? {})).toHaveLength(0);
  });

  it('exposes no update or delete method — append-only by construction', () => {
    expect(
      (service as unknown as Record<string, unknown>).update,
    ).toBeUndefined();
    expect(
      (service as unknown as Record<string, unknown>).delete,
    ).toBeUndefined();
    expect(
      (service as unknown as Record<string, unknown>).remove,
    ).toBeUndefined();
  });
});
