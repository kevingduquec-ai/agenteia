import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  countConversationsHandledSince,
  countLiveVisitors,
  getConversationOverview,
  getIntentBreakdown,
  getRatingSummary,
  getSupportResponseStats,
  getTopConsultedProducts,
  getUnmetDemandSummary,
  type TenantRow,
} from '@prefiero-ia/database';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { AdminAuthGuard, AdminOnlyGuard } from './admin-auth.guard.js';

class RangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

// "Personas que visitan la pagina en vivo, productos mas consultados, y
// cosas que podrian generar interes a los dueños del marketplace" —
// pedido explicito del usuario (sección 41-46 del documento maestro).
// AdminOnlyGuard va DESPUES de AdminAuthGuard a proposito (necesita
// request.adminUser, que pone el primero) — el rol "soporte" nunca debe
// entrar aqui. Todo se filtra por el tenant de quien esta autenticado —
// un admin de un cliente nunca ve las cifras de otro.
@UseGuards(AdminAuthGuard, AdminOnlyGuard)
@Controller('admin/stats')
export class AdminStatsController {
  @Get('overview')
  async overview(@CurrentTenant() tenant: TenantRow) {
    const [liveVisitors, conversations] = await Promise.all([
      countLiveVisitors(tenant.id, 5),
      getConversationOverview(tenant.id),
    ]);
    return { liveVisitors, ...conversations };
  }

  @Get('top-products')
  async topProducts(@Query() query: RangeDto, @CurrentTenant() tenant: TenantRow) {
    return getTopConsultedProducts(tenant.id, query.limit ?? 10, query.days ?? 7);
  }

  @Get('unmet-demand')
  async unmetDemand(@Query() query: RangeDto, @CurrentTenant() tenant: TenantRow) {
    return getUnmetDemandSummary(tenant.id, query.limit ?? 10, query.days ?? 30);
  }

  @Get('intent-breakdown')
  async intentBreakdown(@Query() query: RangeDto, @CurrentTenant() tenant: TenantRow) {
    return getIntentBreakdown(tenant.id, query.days ?? 7);
  }

  // Pedido explicito del usuario: "cuantos chats fueron atendidos por los
  // agentes de soporte en tiempo real" y "verifica los tiempos en que
  // llegan esas respuestas, debe ser inmediato" — este endpoint hace ambas
  // cosas medibles en el dashboard en vez de darlas por hecho. "Hoy" es
  // medianoche del servidor hasta ahora, coherente con `conversationsToday`
  // de `overview`.
  @Get('support')
  async support(@CurrentTenant() tenant: TenantRow) {
    const sinceToday = startOfToday();
    const [handledToday, responseStats, ratingSummary] = await Promise.all([
      countConversationsHandledSince(tenant.id, sinceToday),
      getSupportResponseStats(tenant.id, sinceToday),
      getRatingSummary(tenant.id, sinceToday),
    ]);
    return {
      handledToday,
      escalatedToday: responseStats.escalated,
      answeredToday: responseStats.answered,
      averageResponseSeconds: responseStats.averageResponseSeconds,
      rating: ratingSummary,
    };
  }
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
