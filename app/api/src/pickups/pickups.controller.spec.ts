import { Test, TestingModule } from '@nestjs/testing';
import { PickupsController } from './pickups.controller';
import { PickupsService } from './pickups.service';

describe('PickupsController', () => {
  let controller: PickupsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PickupsController],
      providers: [PickupsService],
    }).compile();

    controller = module.get<PickupsController>(PickupsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
