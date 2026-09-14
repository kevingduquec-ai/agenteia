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
}

export async function createAdminUser(username: string, passwordHash: string, role: ManagedAdminRole): Promise<AdminUserRow> {
  const pool = getPool();
  const result = await pool.query<{ id: string; username: string; role: ManagedAdminRole; created_at: Date }>(
    `INSERT INTO admin_users (username, password_hash, role) VALUES ($1, $2, $3)
     RETURNING id, username, role, created_at`,
    [username, passwordHash, role],
  );
  const row = result.rows[0];
  return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const pool = getPool();
  const result = await pool.query<{ id: string; username: string; role: ManagedAdminRole; created_at: Date }>(
    'SELECT id, username, role, created_at FROM admin_users ORDER BY created_at ASC',
  );
  return result.rows.map((row) => ({ id: row.id, username: row.username, role: row.role, createdAt: row.created_at }));
}

export async function deleteAdminUser(id: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM admin_users WHERE id = $1', [id]);
}

/** Pedido explicito del usuario: admin y soporte nunca cambian su propia contraseña — solo el owner puede resetearla desde el panel. */
export async function updateAdminUserPassword(id: string, passwordHash: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
  return (result.rowCount ?? 0) > 0;
}

/** Usado en login — unica funcion que trae el hash, nunca se expone en `listAdminUsers`. */
export async function findAdminUserByUsername(username: string): Promise<AdminUserCredentials | null> {
  const pool = getPool();
  const result = await pool.query<{ id: string; username: string; password_hash: string; role: ManagedAdminRole; created_at: Date }>(
    'SELECT id, username, password_hash, role, created_at FROM admin_users WHERE username = $1',
    [username],
  );
  const row = result.rows[0];
  return row
    ? { id: row.id, username: row.username, passwordHash: row.password_hash, role: row.role, createdAt: row.created_at }
    : null;
}

/** Base del limite de cupos del plan (pedido del usuario: "vendo con un solo agente de soporte y un admin, con la posibilidad de que me compren otro"). */
export async function countAdminUsersByRole(role: ManagedAdminRole): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ count: string }>('SELECT count(*) FROM admin_users WHERE role = $1', [role]);
  return Number(result.rows[0].count);
}
