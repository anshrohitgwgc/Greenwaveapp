import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

function sanitize(user: { id: number; fullName: string; email: string; role: string; createdAt: Date }) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @Roles('admin')
  async create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthenticatedUser) {
    const user = await this.usersService.create(dto);
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'user.created',
      entityType: 'user',
      entityId: String(user.id),
      summary: `${actor.email} created user ${user.email} (${user.role})`,
    });
    return sanitize(user);
  }

  @Get()
  @Roles('admin', 'manager')
  async findAll() {
    const users = await this.usersService.findAll();
    return users.map(sanitize);
  }

  @Get('me')
  async me(@CurrentUser() actor: AuthenticatedUser) {
    const user = await this.usersService.findOne(actor.id);
    if (!user) throw new NotFoundException('User not found');
    return sanitize(user);
  }

  @Get(':id')
  @Roles('admin', 'manager')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const user = await this.usersService.findOne(id);
    if (!user) throw new NotFoundException('User not found');
    return sanitize(user);
  }

  @Patch(':id')
  @Roles('admin')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (id === actor.id && dto.role && dto.role !== actor.role) {
      throw new ForbiddenException('Cannot change your own role');
    }
    const user = await this.usersService.update(id, dto);
    if (!user) throw new NotFoundException('User not found');
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'user.updated',
      entityType: 'user',
      entityId: String(id),
      summary: `${actor.email} updated user ${user.email}`,
    });
    return sanitize(user);
  }
}
