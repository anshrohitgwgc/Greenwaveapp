import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PermissionsGuard } from '../common/guards/permissions.guard';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { Employee } from './entities/employee.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import { LeaveRequest } from './entities/leave-request.entity';

export const EMPLOYEES_ENTITIES = [
  Employee,
  AttendanceRecord,
  LeaveBalance,
  LeaveRequest,
];

@Module({
  imports: [
    TypeOrmModule.forFeature(EMPLOYEES_ENTITIES),
    forwardRef(() => WarehousesModule),
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService, PermissionsGuard],
  exports: [EmployeesService, TypeOrmModule],
})
export class EmployeesModule {}
