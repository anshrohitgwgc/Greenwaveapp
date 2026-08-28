import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Timesheet } from './entities/timesheet.entity';
import { TimesheetsController } from './timesheets.controller';
import { TimesheetsService } from './timesheets.service';

@Module({
  imports: [TypeOrmModule.forFeature([Timesheet])],
  controllers: [TimesheetsController],
  providers: [TimesheetsService],
  exports: [TimesheetsService, TypeOrmModule],
})
export class TimesheetsModule {}
