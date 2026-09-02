import { getRepositoryToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { DivisionsService } from '../../src/divisions/divisions.service';
import { UserDivision } from '../../src/divisions/entities/user-division.entity';

/**
 * Provides a **real** DivisionsService backed by an in-memory
 * `user_divisions` table, for unit specs that instantiate a service directly.
 *
 * Deliberately not a stub: division access is an authorization boundary, so
 * the specs that exercise it should run the genuine allow/deny logic. `grants`
 * seeds the table, e.g. `{ 1: ['greenwave'], 2: ['healthcare'] }`.
 */
export function provideDivisionsService(grants: Record<number, string[]> = {}) {
  const rows: UserDivision[] = [];
  for (const [userId, divisions] of Object.entries(grants)) {
    for (const division of divisions) {
      rows.push({
        id: `${userId}-${division}`,
        userId: Number(userId),
        division,
        createdBy: null,
        createdAt: new Date(),
      });
    }
  }

  const repo = {
    find: jest.fn((options?: { where?: { userId?: number } }) => {
      const userId = options?.where?.userId;
      return Promise.resolve(
        userId === undefined ? rows : rows.filter((r) => r.userId === userId),
      );
    }),
    findOne: jest.fn(
      (options: { where: { userId: number; division: string } }) =>
        Promise.resolve(
          rows.find(
            (r) =>
              r.userId === options.where.userId &&
              r.division === options.where.division,
          ) ?? null,
        ),
    ),
    create: jest.fn((data: Partial<UserDivision>) => ({ ...data })),
    save: jest.fn((entities: UserDivision[]) => {
      rows.push(...entities);
      return Promise.resolve(entities);
    }),
    delete: jest.fn((criteria: { userId: number }) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].userId === criteria.userId) rows.splice(i, 1);
      }
      return Promise.resolve({ affected: 1 });
    }),
  };

  return {
    providers: [
      DivisionsService,
      { provide: getRepositoryToken(UserDivision), useValue: repo },
    ],
    repo,
    rows,
  };
}

/**
 * Grants divisions to users in an e2e sqlite datasource.
 *
 * E2E suites that predate division access control seed their users directly
 * through the repository, so they would otherwise end up with zero division
 * grants and see nothing. Those suites assert *warehouse* and *role*
 * behaviour, so they call this to hold division access constant. Division
 * isolation itself is covered by test/division-isolation.e2e-spec.ts, which
 * deliberately grants selectively.
 */
export async function grantDivisions(
  dataSource: DataSource,
  userIds: number[],
  divisions: string[] = ['greenwave', 'healthcare'],
): Promise<void> {
  const repo = dataSource.getRepository(UserDivision);
  const rows: Array<Partial<UserDivision>> = [];
  for (const userId of userIds) {
    for (const division of divisions) {
      rows.push({ userId, division, createdBy: null });
    }
  }
  if (rows.length > 0) await repo.save(rows);
}
