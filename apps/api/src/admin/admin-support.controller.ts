import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  addSupportAgentMessage,
  cancelConversation,
  closeConversation,
  getConversationTenantId,
  getFullConversationThread,
  listSupportConversations,
  resolveConversation,
  type ConversationStatus,
  type TenantRow,
} from '@prefiero-ia/database';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
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
 *
 * Cada accion sobre un `conversationId` puntual (mensajes, responder,
 * resolver/cerrar/cancelar) verifica primero que esa conversacion
 * pertenezca al tenant de quien esta autenticado — sin esto, un agente de
 * soporte del cliente A podria leer o responder conversaciones del
 * cliente B con solo adivinar/enumerar un UUID.
 */
@UseGuards(AdminAuthGuard)
@Controller('admin/support')
export class AdminSupportController {
  @Get('conversations')
  async listConversations(@Query() query: ListTicketsQueryDto, @CurrentTenant() tenant: TenantRow) {
    const statuses = query.status ? [query.status] : ['needs_support' as const];
    return listSupportConversations(tenant.id, statuses);
  }

  @Get('conversations/:id/messages')
  async getMessages(@Param('id', ParseUUIDPipe) conversationId: string, @CurrentTenant() tenant: TenantRow) {
    await assertOwnedByTenant(conversationId, tenant.id);
    return getFullConversationThread(conversationId);
  }

  @Post('conversations/:id/reply')
  async reply(@Param('id', ParseUUIDPipe) conversationId: string, @Body() body: ReplyDto, @CurrentTenant() tenant: TenantRow) {
    await assertOwnedByTenant(conversationId, tenant.id);
    await addSupportAgentMessage(conversationId, body.content.trim());
    return { ok: true };
  }

  // Las tres acciones que pidio el usuario — cualquiera de ellas hace que
  // el chat del cliente se reinicie solo (el widget detecta el cambio de
  // status via polling en GET /chat/status).
  @Post('conversations/:id/resolve')
  async resolve(@Param('id', ParseUUIDPipe) conversationId: string, @CurrentTenant() tenant: TenantRow) {
    await assertOwnedByTenant(conversationId, tenant.id);
    await resolveConversation(conversationId);
    return { ok: true };
  }

  @Post('conversations/:id/close')
  async close(@Param('id', ParseUUIDPipe) conversationId: string, @CurrentTenant() tenant: TenantRow) {
    await assertOwnedByTenant(conversationId, tenant.id);
    await closeConversation(conversationId);
    return { ok: true };
  }

  @Post('conversations/:id/cancel')
  async cancel(@Param('id', ParseUUIDPipe) conversationId: string, @CurrentTenant() tenant: TenantRow) {
    await assertOwnedByTenant(conversationId, tenant.id);
    await cancelConversation(conversationId);
    return { ok: true };
  }
}

async function assertOwnedByTenant(conversationId: string, tenantId: string): Promise<void> {
  const owner = await getConversationTenantId(conversationId);
  if (owner !== tenantId) {
    throw new NotFoundException('Esa conversación no existe.');
  }
}
