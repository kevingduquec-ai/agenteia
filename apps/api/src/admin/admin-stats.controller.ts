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
} from '@prefiero-ia/database';
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
// entrar aqui.
@UseGuards(AdminAuthGuard, AdminOnlyGuard)
@Controller('admin/stats')
export class AdminStatsController {
  @Get('overview')
  async overview() {
    const [liveVisitors, conversations] = await Promise.all([countLiveVisitors(5), getConversationOverview()]);
    return { liveVisitors, ...conversations };
  }

  @Get('top-products')
  async topProducts(@Query() query: RangeDto) {
    return getTopConsultedProducts(query.limit ?? 10, query.days ?? 7);
  }

  @Get('unmet-demand')
  async unmetDemand(@Query() query: RangeDto) {
    return getUnmetDemandSummary(query.limit ?? 10, query.days ?? 30);
  }

  @Get('intent-breakdown')
  async intentBreakdown(@Query() query: RangeDto) {
    return getIntentBreakdown(query.days ?? 7);
  }

  // Pedido explicito del usuario: "cuantos chats fueron atendidos por los
  // agentes de soporte en tiempo real" y "verifica los tiempos en que
  // llegan esas respuestas, debe ser inmediato" — este endpoint hace ambas
  // cosas medibles en el dashboard en vez de darlas por hecho. "Hoy" es
  // medianoche del servidor hasta ahora, coherente con `conversationsToday`
  // de `overview`.
  @Get('support')
  async support() {
    const sinceToday = startOfToday();
    const [handledToday, responseStats, ratingSummary] = await Promise.all([
      countConversationsHandledSince(sinceToday),
      getSupportResponseStats(sinceToday),
      getRatingSummary(sinceToday),
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
