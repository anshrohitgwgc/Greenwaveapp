import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DivisionsService } from './divisions.service';

@Controller('divisions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DivisionsController {
  constructor(private readonly divisionsService: DivisionsService) {}

  /**
   * The divisions this user may actually operate in. The frontend renders its
   * switcher from this and nothing else, so the client can never invent a
   * division it has no grant for — and a single-division user gets a
   * one-element list rather than a switcher offering something unreachable.
   */
  @Get()
  mine(@CurrentUser() actor: AuthenticatedUser) {
    return this.divisionsService.getDivisionsForActor(actor);
  }

  /**
   * The full catalogue of divisions that exist, for admin assignment UI.
   * Listing them is not access to their data.
   */
  @Get('catalog')
  catalog() {
    return this.divisionsService.listDivisions();
  }
}
