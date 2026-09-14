import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  addSupportAgentMessage,
  cancelConversation,
  closeConversation,
  getFullConversationThread,
  listSupportConversations,
  resolveConversation,
  type ConversationStatus,
} from '@prefiero-ia/database';
import { AdminAuthGuard } from './admin-auth.guard.js';

const TICKET_STATUSES: ConversationStatus[] = ['needs_support', 'resolved', 'closed', 'cancelled'];

class ListTicketsQueryDto {
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: ConversationStatus;
}

class ReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}

/**
 * Bandeja de soporte (pedido explicito del usuario): un rol "soporte",
 * separado de "admin", que SOLO puede ver y responder mensajes de
 * soporte — nunca dashboards ni analitica. Por eso usa unicamente
 * `AdminAuthGuard` (cualquier cuenta valida), sin `AdminOnlyGuard`.
 */
@UseGuards(AdminAuthGuard)
@Controller('admin/support')
export class AdminSupportController {
  @Get('conversations')
  async listConversations(@Query() query: ListTicketsQueryDto) {
    const statuses = query.status ? [query.status] : ['needs_support' as const];
    return listSupportConversations(statuses);
  }

  @Get('conversations/:id/messages')
  async getMessages(@Param('id', ParseUUIDPipe) conversationId: string) {
    return getFullConversationThread(conversationId);
  }

  @Post('conversations/:id/reply')
  async reply(@Param('id', ParseUUIDPipe) conversationId: string, @Body() body: ReplyDto) {
    await addSupportAgentMessage(conversationId, body.content.trim());
    return { ok: true };
  }

  // Las tres acciones que pidio el usuario — cualquiera de ellas hace que
  // el chat del cliente se reinicie solo (el widget detecta el cambio de
  // status via polling en GET /chat/status).
  @Post('conversations/:id/resolve')
  async resolve(@Param('id', ParseUUIDPipe) conversationId: string) {
    await resolveConversation(conversationId);
    return { ok: true };
  }

  @Post('conversations/:id/close')
  async close(@Param('id', ParseUUIDPipe) conversationId: string) {
    await closeConversation(conversationId);
    return { ok: true };
  }

  @Post('conversations/:id/cancel')
  async cancel(@Param('id', ParseUUIDPipe) conversationId: string) {
    await cancelConversation(conversationId);
    return { ok: true };
  }
}
