import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateCustomerDto } from './create-customer.dto';

describe('CreateCustomerDto', () => {
  it('accepts a blank email/warehouseId the way the Add Customer form submits them (empty string, not omitted)', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      name: 'Blank Optional Fields Co',
      billTo: '123 St',
      shipTo: '',
      email: '',
      warehouseId: '',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.email).toBeUndefined();
    expect(dto.warehouseId).toBeUndefined();
  });

  it('still rejects a genuinely malformed email', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      name: 'Bad Email Co',
      email: 'not-an-email',
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('still rejects a genuinely malformed warehouseId', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      name: 'Bad Warehouse Co',
      warehouseId: 'not-a-uuid',
    });

    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'warehouseId')).toBe(true);
  });

  it('rejects a missing name', async () => {
    const dto = plainToInstance(CreateCustomerDto, { billTo: '123 St' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});
