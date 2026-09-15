import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ChatService } from './chat.service';
import { CreateMessageDto } from './dto/create-message.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('messages')
  @Roles('admin', 'manager', 'staff', 'driver')
  async createMessage(
    @Body() dto: CreateMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.chatService.createMessage(dto, actor);
  }

  @Get('messages')
  @Roles('admin', 'manager', 'staff', 'driver')
  async listMessages(
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @CurrentUser() actor?: AuthenticatedUser,
  ) {
    if (actor) {
      this.chatService.recordActivity(actor);
    }
    return this.chatService.listMessages({
      limit: limit ? Number(limit) : undefined,
      before,
    });
  }

  @Get('online')
  @Roles('admin', 'manager', 'staff', 'driver')
  getOnlineStaff(@CurrentUser() actor?: AuthenticatedUser) {
    if (actor) {
      this.chatService.recordActivity(actor);
    }
    return this.chatService.getOnlineStaff();
  }

  @Sse('stream')
  @Roles('admin', 'manager', 'staff', 'driver')
  streamMessages(): Observable<MessageEvent> {
    return this.chatService.getMessageStream();
  }
}
