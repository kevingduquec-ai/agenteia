import { getPool } from '../pool.js';

export type KnowledgeSourceKind = 'heading' | 'frequent-questions-api';

export interface TenantKnowledgeSourceRow {
  id: string;
  tenantId: string;
  url: string;
  kind: KnowledgeSourceKind;
  sourceUrl: string | null;
  headers: Record<string, string> | null;
}

interface RawKnowledgeSourceRow {
  id: string;
  tenant_id: string;
  url: string;
  kind: string;
  source_url: string | null;
  headers: Record<string, string> | null;
}

function toKnowledgeSourceRow(row: RawKnowledgeSourceRow): TenantKnowledgeSourceRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    url: row.url,
    kind: row.kind as KnowledgeSourceKind,
    sourceUrl: row.source_url,
    headers: row.headers,
  };
}

const SELECT_COLUMNS = 'id, tenant_id, url, kind, source_url, headers';

/**
 * Las paginas/endpoints que `ingest-knowledge` visita para ESTE tenant.
 * Reemplaza la vieja lista fija en codigo (`apps/worker/src/knowledge/
 * sources.ts`) que siempre traia el contenido de Prefiero ACR+ sin
 * importar el tenant pasado por `--tenant` — ver docs/MULTI-TENANCY.md.
 */
export async function listKnowledgeSourcesByTenant(tenantId: string): Promise<TenantKnowledgeSourceRow[]> {
  const pool = getPool();
  const result = await pool.query<RawKnowledgeSourceRow>(
    `SELECT ${SELECT_COLUMNS} FROM tenant_knowledge_sources WHERE tenant_id = $1 ORDER BY created_at`,
    [tenantId],
  );
  return result.rows.map(toKnowledgeSourceRow);
}

export interface AddKnowledgeSourceInput {
  url: string;
  kind: KnowledgeSourceKind;
  sourceUrl?: string | null;
  headers?: Record<string, string> | null;
}

/**
 * Alta de una fuente de conocimiento para un tenant (onboarding de un
 * cliente nuevo, ver `pnpm run add-knowledge-source` y `AdminTenantsController`).
 * Idempotente: correrla otra vez con la misma URL actualiza
 * kind/source_url/headers en vez de duplicar la fila.
 */
export async function addKnowledgeSource(tenantId: string, input: AddKnowledgeSourceInput): Promise<TenantKnowledgeSourceRow> {
  const pool = getPool();
  const result = await pool.query<RawKnowledgeSourceRow>(
    `INSERT INTO tenant_knowledge_sources (tenant_id, url, kind, source_url, headers)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, url) DO UPDATE SET kind = EXCLUDED.kind, source_url = EXCLUDED.source_url, headers = EXCLUDED.headers
     RETURNING ${SELECT_COLUMNS}`,
    [tenantId, input.url, input.kind, input.sourceUrl ?? null, input.headers ? JSON.stringify(input.headers) : null],
  );
  return toKnowledgeSourceRow(result.rows[0]);
}

/** Baja de una fuente (ej. una URL que ya no existe en el sitio del cliente). Devuelve false si esa fuente no existia para ese tenant — nunca borra la de otro. */
export async function deleteKnowledgeSource(tenantId: string, id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query('DELETE FROM tenant_knowledge_sources WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  return result.rowCount !== null && result.rowCount > 0;
}
