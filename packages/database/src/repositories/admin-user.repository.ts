import { getPool } from '../pool.js';

export type ManagedAdminRole = 'admin' | 'soporte';

export interface AdminUserRow {
  id: string;
  username: string;
  role: ManagedAdminRole;
  createdAt: Date;
}

export interface AdminUserCredentials extends AdminUserRow {
  passwordHash: string;
  tenantId: string;
}

export async function createAdminUser(
  tenantId: string,
  username: string,
  passwordHash: string,
  role: ManagedAdminRole,
): Promise<AdminUserRow> {
  const pool = getPool();
  const result = await pool.query<{ id: string; username: string; role: ManagedAdminRole; created_at: Date }>(
    `INSERT INTO admin_users (tenant_id, username, password_hash, role) VALUES ($1, $2, $3, $4)
     RETURNING id, username, role, created_at`,
    [tenantId, username, passwordHash, role],
  );
  const row = result.rows[0];
  return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
}

export async function listAdminUsers(tenantId: string): Promise<AdminUserRow[]> {
  const pool = getPool();
  const result = await pool.query<{ id: string; username: string; role: ManagedAdminRole; created_at: Date }>(
    'SELECT id, username, role, created_at FROM admin_users WHERE tenant_id = $1 ORDER BY created_at ASC',
    [tenantId],
  );
  return result.rows.map((row) => ({ id: row.id, username: row.username, role: row.role, createdAt: row.created_at }));
}

export async function deleteAdminUser(tenantId: string, id: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM admin_users WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
}

/** Pedido explicito del usuario: admin y soporte nunca cambian su propia contraseña — solo el owner puede resetearla desde el panel. */
export async function updateAdminUserPassword(tenantId: string, id: string, passwordHash: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2 AND tenant_id = $3', [
    passwordHash,
    id,
    tenantId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Usado en login — unica funcion que trae el hash, nunca se expone en
 * `listAdminUsers`. El username solo es unico DENTRO de un tenant (dos
 * clientes distintos podrian, cada uno, tener un agente de soporte
 * llamado "soporte1"), asi que el tenant debe resolverse ANTES de llegar
 * aqui — normalmente por el host de la peticion (ver
 * apps/api/src/tenant/tenant.middleware.ts), nunca por lo que el usuario
 * escriba en el formulario de login.
 */
export async function findAdminUserByUsername(tenantId: string, username: string): Promise<AdminUserCredentials | null> {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    username: string;
    password_hash: string;
    role: ManagedAdminRole;
    created_at: Date;
    tenant_id: string;
  }>('SELECT id, username, password_hash, role, created_at, tenant_id FROM admin_users WHERE tenant_id = $1 AND username = $2', [
    tenantId,
    username,
  ]);
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        username: row.username,
        passwordHash: row.password_hash,
        role: row.role,
        createdAt: row.created_at,
        tenantId: row.tenant_id,
      }
    : null;
}

/** Base del limite de cupos del plan (pedido del usuario: "vendo con un solo agente de soporte y un admin, con la posibilidad de que me compren otro") — ahora el tope en si vive en `tenants.max_admin_seats`/`max_support_seats`, esto solo cuenta cuantos ya existen para ESE tenant. */
export async function countAdminUsersByRole(tenantId: string, role: ManagedAdminRole): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ count: string }>('SELECT count(*) FROM admin_users WHERE tenant_id = $1 AND role = $2', [
    tenantId,
    role,
  ]);
  return Number(result.rows[0].count);
}
