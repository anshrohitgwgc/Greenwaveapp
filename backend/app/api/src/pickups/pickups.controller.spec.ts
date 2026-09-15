import { Test, TestingModule } from '@nestjs/testing';
import { PickupsController } from './pickups.controller';
import { PickupsService } from './pickups.service';

describe('PickupsController', () => {
  let controller: PickupsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PickupsController],
      providers: [
        {
          provide: PickupsService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PickupsController>(PickupsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
