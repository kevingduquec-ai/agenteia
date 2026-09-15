import { getPool } from '../pool.js';

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  host: string;
  crawlerBaseUrl: string;
  extraCorsOrigins: string | null;
  maxAdminSeats: number;
  maxSupportSeats: number;
  isActive: boolean;
}

interface RawTenantRow {
  id: string;
  slug: string;
  name: string;
  host: string;
  crawler_base_url: string;
  extra_cors_origins: string | null;
  max_admin_seats: number;
  max_support_seats: number;
  is_active: boolean;
}

const SELECT_COLUMNS = 'id, slug, name, host, crawler_base_url, extra_cors_origins, max_admin_seats, max_support_seats, is_active';

function toTenantRow(row: RawTenantRow): TenantRow {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    host: row.host,
    crawlerBaseUrl: row.crawler_base_url,
    extraCorsOrigins: row.extra_cors_origins,
    maxAdminSeats: row.max_admin_seats,
    maxSupportSeats: row.max_support_seats,
    isActive: row.is_active,
  };
}

/**
 * Resuelve que tenant corresponde a un host (ej. "acr.prefi.io") — el
 * mecanismo central de la arquitectura multi-tenant (ver
 * apps/api/src/tenant/tenant.middleware.ts). `host` se guarda sin puerto;
 * el caller es responsable de quitarlo antes de llamar aqui.
 */
export async function findTenantByHost(host: string): Promise<TenantRow | null> {
  const pool = getPool();
  const result = await pool.query<RawTenantRow>(`SELECT ${SELECT_COLUMNS} FROM tenants WHERE host = $1 AND is_active`, [
    host.toLowerCase(),
  ]);
  return result.rows[0] ? toTenantRow(result.rows[0]) : null;
}

export async function findTenantBySlug(slug: string): Promise<TenantRow | null> {
  const pool = getPool();
  const result = await pool.query<RawTenantRow>(`SELECT ${SELECT_COLUMNS} FROM tenants WHERE slug = $1 AND is_active`, [slug]);
  return result.rows[0] ? toTenantRow(result.rows[0]) : null;
}

export async function findTenantById(id: string): Promise<TenantRow | null> {
  const pool = getPool();
  const result = await pool.query<RawTenantRow>(`SELECT ${SELECT_COLUMNS} FROM tenants WHERE id = $1`, [id]);
  return result.rows[0] ? toTenantRow(result.rows[0]) : null;
}

export async function listTenants(): Promise<TenantRow[]> {
  const pool = getPool();
  const result = await pool.query<RawTenantRow>(`SELECT ${SELECT_COLUMNS} FROM tenants ORDER BY created_at`);
  return result.rows.map(toTenantRow);
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  host: string;
  crawlerBaseUrl: string;
  extraCorsOrigins?: string | null;
  maxAdminSeats?: number;
  maxSupportSeats?: number;
}

/** Solo la usa el `owner` (superadmin de la plataforma) — crear un tenant nuevo es, en la practica, dar de alta un cliente nuevo. */
export async function createTenant(input: CreateTenantInput): Promise<TenantRow> {
  const pool = getPool();
  const result = await pool.query<RawTenantRow>(
    `INSERT INTO tenants (slug, name, host, crawler_base_url, extra_cors_origins, max_admin_seats, max_support_seats)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.slug,
      input.name,
      input.host.toLowerCase(),
      input.crawlerBaseUrl,
      input.extraCorsOrigins ?? null,
      input.maxAdminSeats ?? 1,
      input.maxSupportSeats ?? 1,
    ],
  );
  return toTenantRow(result.rows[0]);
}
