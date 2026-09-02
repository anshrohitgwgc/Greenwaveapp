import { plainToInstance } from 'class-transformer';
import { validate, ValidatorOptions } from 'class-validator';

import { UpdateMaterialDto } from './update-material.dto';

// Production runs the global ValidationPipe with whitelist + forbidNonWhitelisted
// (see main.ts). Those two flags are what turn a field the DTO does not declare
// into a "property <x> should not exist" 400, so the DTO must be validated under
// the same options here for these tests to mean anything.
const PROD_VALIDATOR_OPTIONS: ValidatorOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

describe('UpdateMaterialDto', () => {
  it('accepts the exact payload the Edit Product form submits', async () => {
    const dto = plainToInstance(UpdateMaterialDto, {
      name: 'Mixed Paper',
      category: 'Fibre',
      description: 'Baled mixed office paper',
      division: 'recycling',
      active: true,
    });

    const errors = await validate(dto, PROD_VALIDATOR_OPTIONS);
    expect(errors).toHaveLength(0);
  });

  it('accepts description on its own', async () => {
    const dto = plainToInstance(UpdateMaterialDto, {
      description: 'Updated description copy',
    });

    const errors = await validate(dto, PROD_VALIDATOR_OPTIONS);
    expect(errors).toHaveLength(0);
  });

  it('accepts both supported divisions', async () => {
    for (const division of ['recycling', 'healthcare']) {
      const dto = plainToInstance(UpdateMaterialDto, { division });
      const errors = await validate(dto, PROD_VALIDATOR_OPTIONS);
      expect(errors).toHaveLength(0);
    }
  });

  it('accepts a warehouseId reassignment', async () => {
    const dto = plainToInstance(UpdateMaterialDto, {
      warehouseId: '11111111-1111-4111-8111-111111111111',
    });

    const errors = await validate(dto, PROD_VALIDATOR_OPTIONS);
    expect(errors).toHaveLength(0);
  });

  it('keeps division constrained to recycling/healthcare', async () => {
    const dto = plainToInstance(UpdateMaterialDto, { division: 'finance' });
    const errors = await validate(dto, PROD_VALIDATOR_OPTIONS);
    expect(errors.some((e) => e.property === 'division')).toBe(true);
  });

  it('still rejects a malformed warehouseId rather than passing it through', async () => {
    const dto = plainToInstance(UpdateMaterialDto, {
      warehouseId: 'not-a-uuid',
    });

    const errors = await validate(dto, PROD_VALIDATOR_OPTIONS);
    expect(errors.some((e) => e.property === 'warehouseId')).toBe(true);
  });

  it('still rejects unknown properties (whitelist behaviour is not weakened)', async () => {
    const dto = plainToInstance(UpdateMaterialDto, {
      name: 'Mixed Paper',
      isAdmin: true,
    });

    const errors = await validate(dto, PROD_VALIDATOR_OPTIONS);
    expect(errors.some((e) => e.property === 'isAdmin')).toBe(true);
  });

  it('allows a partial update (every field optional on PATCH)', async () => {
    const dto = plainToInstance(UpdateMaterialDto, { name: 'Just the name' });
    const errors = await validate(dto, PROD_VALIDATOR_OPTIONS);
    expect(errors).toHaveLength(0);
  });
});
