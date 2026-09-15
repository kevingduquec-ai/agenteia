import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { getConversationTenantId, RatingNotAllowedError, type TenantRow } from '@prefiero-ia/database';
import type { Response } from 'express';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { ChatService } from './chat.service.js';

const MAX_MESSAGE_LENGTH = 2000;

// Ruta de la pagina host desde donde se abrio el widget embebido (sección
// 33-34) — nunca se confia en nombre/precio/id que el host pudiera mandar,
// solo en la ruta, que se resuelve contra el catalogo real del lado del
// servidor.
class PageContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  path?: string;
}

class StartSessionDto {
  @IsUUID()
  anonymousSessionId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PageContextDto)
  pageContext?: PageContextDto;
}

class NewConversationDto {
  @IsUUID()
  sessionId!: string;
}

class SendMessageDto {
  @IsUUID()
  conversationId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_LENGTH, { message: `El mensaje no puede superar ${MAX_MESSAGE_LENGTH} caracteres.` })
  message!: string;

  // Tarjeta "Problemas con tu compra o tu pedido" del widget: salta el
  // clasificador de intencion y cae siempre en soporte humano — un
  // comprador que ya viene frustrado no puede depender de que la IA
  // adivine bien la intencion.
  @IsOptional()
  @IsBoolean()
  forceHumanSupport?: boolean;
}

class ConversationStatusQueryDto {
  @IsUUID()
  conversationId!: string;
}

// Pedido explicito del usuario: calificar la atencion al final de la
// conversacion. `rating` restringido a 1..5 (no un @Min/@Max numerico
// generico) para que un valor como 0 o 10 nunca llegue a la base de datos.
class RateConversationDto {
  @IsUUID()
  conversationId!: string;

  @IsIn([1, 2, 3, 4, 5])
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('session')
  async startSession(@Body() body: StartSessionDto, @CurrentTenant() tenant: TenantRow) {
    return this.chatService.startSession(tenant.id, body.anonymousSessionId, body.pageContext);
  }

  // El usuario puede reiniciar la conversacion cuando quiera (boton "Nueva
  // conversacion" en el chat) sin perder la sesion anonima ni el historial
  // anterior, que queda guardado bajo la conversacion vieja.
  @Post('conversations/new')
  async newConversation(@Body() body: NewConversationDto, @CurrentTenant() tenant: TenantRow) {
    return this.chatService.startNewConversation(tenant.id, body.sessionId);
  }

  // El chat consume tokens de pago por cada mensaje — un limite mas
  // estricto que el resto de la API evita que alguien vacie el saldo del
  // proveedor de IA a punta de requests automatizados.
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('message')
  async sendMessage(@Body() body: SendMessageDto, @CurrentTenant() tenant: TenantRow) {
    await assertOwnedByTenant(body.conversationId, tenant.id);
    return this.chatService.sendMessage(tenant.id, body.conversationId, body.message.trim(), body.forceHumanSupport);
  }

  // El widget lo consulta cada pocos segundos (sección: soporte humano) —
  // detecta respuestas nuevas de un agente y cuando resuelve/cierra/
  // cancela la conversacion, para reiniciar el chat del cliente solo.
  // Barato (sin LLM), usa el limite global por defecto, no el estricto.
  @Get('status')
  async status(@Query() query: ConversationStatusQueryDto, @CurrentTenant() tenant: TenantRow) {
    await assertOwnedByTenant(query.conversationId, tenant.id);
    return this.chatService.getConversationState(query.conversationId);
  }

  // Barato (un solo INSERT, sin LLM) — el limite por defecto alcanza de sobra.
  @Post('rating')
  async rate(@Body() body: RateConversationDto, @CurrentTenant() tenant: TenantRow) {
    try {
      await this.chatService.rateConversation(tenant.id, body.conversationId, body.rating, body.comment);
    } catch (error) {
      if (error instanceof RatingNotAllowedError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return { ok: true };
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('stream')
  async stream(@Body() body: SendMessageDto, @CurrentTenant() tenant: TenantRow, @Res() res: Response) {
    await assertOwnedByTenant(body.conversationId, tenant.id);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const chunk of this.chatService.streamMessage(tenant.id, body.conversationId, body.message.trim(), body.forceHumanSupport)) {
        res.write(`data: ${JSON.stringify({ delta: chunk.delta, done: chunk.done, products: chunk.products })}\n\n`);
      }
    } catch {
      res.write(`data: ${JSON.stringify({ error: 'Ocurrió un error generando la respuesta. Intenta de nuevo en un momento.', done: true })}\n\n`);
    } finally {
      res.end();
    }
  }
}

/**
 * El chat es publico/sin autenticacion (el comprador es anonimo) — un
 * `conversationId` es un UUID que igual podria pertenecer a OTRO tenant.
 * Sin esta verificacion, alguien que adivine/reuse un UUID ajeno podria
 * leer el estado o escribir mensajes en una conversacion de otro cliente.
 */
async function assertOwnedByTenant(conversationId: string, tenantId: string): Promise<void> {
  const owner = await getConversationTenantId(conversationId);
  if (owner !== tenantId) {
    throw new NotFoundException('Esa conversación no existe.');
  }
}
