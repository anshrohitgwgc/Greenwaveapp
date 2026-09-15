import { Test, TestingModule } from '@nestjs/testing';
import { PickupsService } from './pickups.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Pickup } from './entities/pickup.entity';

describe('PickupsService', () => {
  let service: PickupsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PickupsService,
        {
          provide: getRepositoryToken(Pickup),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PickupsService>(PickupsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
