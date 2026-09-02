import { ArrayUnique, IsArray, IsIn, IsString } from 'class-validator';

import { ALL_DIVISIONS } from '../divisions.constants';

export class AssignDivisionsDto {
  /**
   * Canonical division keys. An empty array is meaningful and allowed: it
   * revokes all division access, which is also the state every new account
   * starts in.
   */
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(ALL_DIVISIONS, {
    each: true,
    message: 'division must be one of: greenwave, healthcare',
  })
  divisions: string[];
}
