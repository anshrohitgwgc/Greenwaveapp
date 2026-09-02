import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  ALL_DIVISIONS,
  DIVISION_GREENWAVE,
  DIVISION_LABELS,
  DIVISION_STORAGE_WRITE_VALUE,
  Division,
  divisionStorageValues,
  normalizeDivision,
} from './divisions.constants';
import { UserDivision } from './entities/user-division.entity';

@Injectable()
export class DivisionsService {
  constructor(
    @InjectRepository(UserDivision)
    private readonly userDivisionRepository: Repository<UserDivision>,
  ) {}

  /**
   * The divisions a user actually holds. Derived purely from explicit
   * `user_divisions` rows — no role shortcut, no implicit "recycling" for
   * accounts that were never assigned anything.
   */
  async getUserDivisions(userId: number): Promise<Division[]> {
    const rows = await this.userDivisionRepository.find({ where: { userId } });
    const canonical = rows
      .map((r) => normalizeDivision(r.division))
      .filter((d): d is Division => d !== null);
    // Stable, de-duplicated order so responses and tests don't depend on
    // row insertion order.
    return ALL_DIVISIONS.filter((d) => canonical.includes(d));
  }

  /**
   * Normalises a client-supplied division, rejecting unknown values with a
   * 400. Never falls back to a default: an unrecognised division is an error,
   * not an invitation to pick one.
   */
  requireValidDivision(value: unknown): Division {
    const division = normalizeDivision(value);
    if (!division) {
      throw new BadRequestException(
        `division must be one of: ${ALL_DIVISIONS.join(', ')}`,
      );
    }
    return division;
  }

  /**
   * Throws 403 unless the actor holds the given division. `undefined`/`null`
   * means "no division specified", which is left to the caller's own scoping
   * (usually `scopeDivisions`) rather than being silently allowed.
   */
  async assertDivisionAccess(
    actor: AuthenticatedUser,
    division?: string | null,
  ): Promise<Division | null> {
    if (division === undefined || division === null || division === '') {
      return null;
    }

    const canonical = this.requireValidDivision(division);
    const held = await this.resolveActorDivisions(actor);

    if (!held.includes(canonical)) {
      throw new ForbiddenException(
        'You are not authorized to access this business division',
      );
    }

    return canonical;
  }

  /**
   * Authorization check for a division read off a **stored row**.
   *
   * Distinct from `assertDivisionAccess`, which treats a missing value as
   * "caller did not ask for a division". A stored row that is missing or
   * carries an unrecognised division is resolved to GreenWave — the column
   * DEFAULT every one of these tables was created with — rather than being
   * treated as unscoped and readable by everyone. Fail closed, not open.
   */
  async assertStoredDivisionAccess(
    actor: AuthenticatedUser,
    stored: unknown,
  ): Promise<Division> {
    const canonical = normalizeDivision(stored) ?? DIVISION_GREENWAVE;
    const held = await this.resolveActorDivisions(actor);

    if (!held.includes(canonical)) {
      throw new ForbiddenException(
        'You are not authorized to access this business division',
      );
    }
    return canonical;
  }

  /**
   * Resolves the divisions to scope a query to.
   *
   * - No `requested` division  -> every division the actor holds.
   * - A `requested` division   -> that one, but only after asserting access.
   *
   * An actor with no divisions resolves to `[]`, and callers treat an empty
   * result as "return nothing" rather than "return everything". That is the
   * whole point of defaulting new staff to no access.
   */
  async scopeDivisions(
    actor: AuthenticatedUser,
    requested?: string | null,
  ): Promise<Division[]> {
    const held = await this.resolveActorDivisions(actor);

    if (requested === undefined || requested === null || requested === '') {
      return held;
    }

    const canonical = this.requireValidDivision(requested);
    if (!held.includes(canonical)) {
      throw new ForbiddenException(
        'You are not authorized to access this business division',
      );
    }
    return [canonical];
  }

  /**
   * The storage-level values a `division` column must match for this actor.
   * Returns `[]` when the actor holds nothing, which callers must render as
   * an empty result set.
   */
  async scopeDivisionStorageValues(
    actor: AuthenticatedUser,
    requested?: string | null,
  ): Promise<string[]> {
    return divisionStorageValues(await this.scopeDivisions(actor, requested));
  }

  /** The value to persist into a `division` column for a new row. */
  storageValueFor(division: Division): string {
    return DIVISION_STORAGE_WRITE_VALUE[division];
  }

  /**
   * Prefers the divisions already resolved onto the request by JwtStrategy,
   * falling back to a DB read. The fallback matters for services called
   * outside an HTTP request and for tests that construct an actor by hand.
   */
  private async resolveActorDivisions(
    actor: AuthenticatedUser,
  ): Promise<Division[]> {
    if (Array.isArray(actor.divisions)) {
      return actor.divisions
        .map((d) => normalizeDivision(d))
        .filter((d): d is Division => d !== null);
    }
    return this.getUserDivisions(actor.id);
  }

  listDivisions() {
    return ALL_DIVISIONS.map((key) => ({ key, label: DIVISION_LABELS[key] }));
  }

  async getDivisionsForActor(actor: AuthenticatedUser) {
    const held = await this.resolveActorDivisions(actor);
    return held.map((key) => ({ key, label: DIVISION_LABELS[key] }));
  }

  /**
   * Replaces a user's division grants.
   *
   * `allowedForActor` is the set the *assigning administrator* holds: an admin
   * can never grant a division they do not themselves have, which mirrors the
   * existing rule for warehouse assignment and stops a GreenWave-only admin
   * from minting Healthcare access for anyone (including themselves).
   */
  async assignUserDivisions(
    userId: number,
    divisions: string[],
    actorId: number | null,
    allowedForActor?: Division[],
  ): Promise<Division[]> {
    const requested = (divisions ?? []).map((d) =>
      this.requireValidDivision(d),
    );
    const unique = ALL_DIVISIONS.filter((d) => requested.includes(d));

    if (allowedForActor) {
      const notPermitted = unique.filter((d) => !allowedForActor.includes(d));
      if (notPermitted.length > 0) {
        throw new ForbiddenException(
          'Cannot assign a business division you are not authorized to manage',
        );
      }
    }

    await this.userDivisionRepository.delete({ userId });

    if (unique.length > 0) {
      await this.userDivisionRepository.save(
        unique.map((division) =>
          this.userDivisionRepository.create({
            id: randomUUID(),
            userId,
            division,
            createdBy: actorId ?? null,
          }),
        ),
      );
    }

    return this.getUserDivisions(userId);
  }

  /** Division access for a list of users in one query, for the staff table. */
  async getDivisionsForUsers(
    userIds: number[],
  ): Promise<Map<number, Division[]>> {
    const result = new Map<number, Division[]>();
    for (const id of userIds) result.set(id, []);
    if (userIds.length === 0) return result;

    const rows = await this.userDivisionRepository.find();
    for (const row of rows) {
      if (!result.has(row.userId)) continue;
      const canonical = normalizeDivision(row.division);
      if (!canonical) continue;
      const list = result.get(row.userId)!;
      if (!list.includes(canonical)) list.push(canonical);
    }

    for (const [id, list] of result) {
      result.set(
        id,
        ALL_DIVISIONS.filter((d) => list.includes(d)),
      );
    }
    return result;
  }
}
