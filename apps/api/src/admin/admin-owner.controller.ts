import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { getImpactReport, getPool, type TenantRow } from '@prefiero-ia/database';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { LlmService } from '../llm/llm.service.js';
import { AdminAuthGuard, OwnerOnlyGuard } from './admin-auth.guard.js';

// Solo estas tres ventanas: son las que un dueño de negocio realmente usa
// para reportar resultados ("esta semana", "este mes", "este año") — un
// input numerico libre de dias invitaria a URLs raras sin ningun beneficio real.
const IMPACT_WINDOWS = { week: 7, month: 30, year: 365 } as const;
type ImpactWindow = keyof typeof IMPACT_WINDOWS;

class ImpactQueryDto {
  @IsOptional()
  @IsIn(Object.keys(IMPACT_WINDOWS))
  @Type(() => String)
  window?: ImpactWindow;
}

/**
 * Pedido explicito del usuario: informacion "que me permita demostrarle a
 * Prefiero que tan importante fue Prefi en la semana, en el mes o en el
 * año" — y un modo de solo-lectura para que el owner pueda diagnosticar el
 * sistema sin tocar nada del cliente. Ambos exclusivos de "owner": ni
 * admin ni soporte necesitan ver el estado de los proveedores de IA, y
 * el reporte de impacto es una herramienta comercial del owner, no una
 * metrica operativa del dia a dia del marketplace.
 */
@UseGuards(AdminAuthGuard, OwnerOnlyGuard)
@Controller('admin/owner')
export class AdminOwnerController {
  constructor(private readonly llmService: LlmService) {}

  @Get('impact')
  async impact(@Query() query: ImpactQueryDto, @CurrentTenant() tenant: TenantRow) {
    const window = query.window ?? 'week';
    const days = IMPACT_WINDOWS[window];
    const report = await getImpactReport(tenant.id, days);
    return { window, days, ...report };
  }

  // Solo-lectura a proposito (pedido explicito del usuario): no expone
  // ninguna accion, solo el estado actual de las piezas de las que depende
  // el servicio — util para diagnosticar sin necesidad de acceso al
  // servidor ni a los proveedores directamente.
  @Get('health')
  async health() {
    const [llmProviders, databaseOk] = await Promise.all([this.llmService.healthCheck(), checkDatabase()]);
    return { llmProviders, database: databaseOk };
  }
}

async function checkDatabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    await getPool().query('SELECT 1');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
