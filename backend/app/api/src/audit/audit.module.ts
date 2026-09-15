import { Global, Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WarehousesModule } from '../warehouses/warehouses.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditEvent } from './entities/audit-event.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AuditEvent]),
    forwardRef(() => WarehousesModule),
  ],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
