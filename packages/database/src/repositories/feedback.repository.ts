import { getPool } from '../pool.js';

/** El endpoint de calificacion no tiene autenticacion (el comprador es anonimo) — se lanza cuando el `conversationId` no existe o nunca tuvo un mensaje real, para que el llamador responda con un error limpio en vez de dejar que una violacion de llave foranea llegue sin control hasta el cliente. */
export class RatingNotAllowedError extends Error {}

/**
 * Calificacion de satisfaccion al final de una conversacion (pedido
 * explicito del usuario) — reusa la tabla `feedback` del esquema inicial,
 * que existia desde Fase 0 pero nunca se conectaba a nada. Una conversacion
 * se califica una sola vez (`feedback_conversation_unique`, migracion 0007);
 * un segundo intento actualiza la fila existente en vez de fallar, por si
 * el cliente cambia de opinion antes de cerrar el chat.
 *
 * Exige que la conversacion exista y tenga al menos un mensaje real del
 * comprador — sin esto, cualquiera que abra `/chat/session` en bucle
 * (sin llegar a escribir nada) podria calificar conversaciones vacias y
 * envenenar el promedio que ve el owner. `/chat/session` ya esta acotado
 * por el limite global de la API, asi que esto no reemplaza ese limite,
 * lo complementa exigiendo actividad real, no solo una sesion creada.
 */
export async function submitConversationRating(conversationId: string, rating: number, comment?: string | null): Promise<void> {
  const pool = getPool();
  const activity = await pool.query<{ has_activity: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM messages WHERE conversation_id = $1 AND role = 'user') AS has_activity`,
    [conversationId],
  );
  if (!activity.rows[0]?.has_activity) {
    throw new RatingNotAllowedError('La conversación no existe o todavía no tiene mensajes.');
  }
  await pool.query(
    `INSERT INTO feedback (conversation_id, rating, comment)
     VALUES ($1, $2, $3)
     ON CONFLICT (conversation_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment`,
    [conversationId, rating, comment ?? null],
  );
}

export interface RatingSummary {
  /** Cuantas conversaciones tienen calificacion en la ventana consultada. */
  count: number;
  /** Promedio de 1 a 5 — null si todavia no hay ninguna calificacion. */
  average: number | null;
  /** Distribucion 1..5 -> cuantas calificaciones de ese valor, para el desglose visual del dashboard. */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

/** Visible solo para admin/owner en el panel (nunca para soporte ni para el comprador) — pedido explicito del usuario. */
export async function getRatingSummary(since: Date): Promise<RatingSummary> {
  const pool = getPool();
  const result = await pool.query<{ rating: number; count: string }>(
    `SELECT rating, count(*) FROM feedback WHERE created_at >= $1 GROUP BY rating`,
    [since],
  );
  const distribution: RatingSummary['distribution'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let sum = 0;
  for (const row of result.rows) {
    const rating = row.rating as 1 | 2 | 3 | 4 | 5;
    const count = Number(row.count);
    distribution[rating] = count;
    total += count;
    sum += rating * count;
  }
  return { count: total, average: total > 0 ? sum / total : null, distribution };
}
