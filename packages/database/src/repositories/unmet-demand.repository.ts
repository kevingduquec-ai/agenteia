import { getPool } from '../pool.js';

export interface UnmetDemandInput {
  query: string;
  normalizedIntent?: string | null;
  requestedBrand?: string | null;
  requestedCategory?: string | null;
  budget?: number | null;
  conversationId?: string | null;
}

/** Registra una busqueda de producto que todavia no podemos resolver por catalogo (Fase 5) — insumo para priorizar que construir primero (sección 34/Fase 8), por tenant. */
export async function insertUnmetDemand(tenantId: string, input: UnmetDemandInput): Promise<{ id: string }> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO unmet_demands (tenant_id, query, normalized_intent, requested_brand, requested_category, budget, conversation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      tenantId,
      input.query,
      input.normalizedIntent ?? null,
      input.requestedBrand ?? null,
      input.requestedCategory ?? null,
      input.budget ?? null,
      input.conversationId ?? null,
    ],
  );
  return { id: result.rows[0].id };
}
