import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

// Passport's own types declare `Express.Request.user?: Express.User` and
// expect callers to augment `Express.User` (not `Request` directly) — see
// @types/passport. Augmenting Request directly conflicts with that
// declaration instead of merging into it.
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- standard passport augmentation pattern
    interface User extends AuthenticatedUser {}
  }
}

export {};
