import { getPool } from '../pool.js';

export type ConversationStatus = 'active' | 'needs_support' | 'resolved' | 'closed' | 'cancelled';

export async function getConversationStatus(conversationId: string): Promise<ConversationStatus | null> {
  const pool = getPool();
  const result = await pool.query<{ status: ConversationStatus }>('SELECT status FROM conversations WHERE id = $1', [
    conversationId,
  ]);
  return result.rows[0]?.status ?? null;
}

/** Se llama cuando el Intent Router detecta HUMAN_SUPPORT por primera vez en una conversacion activa — a partir de aqui la IA deja de responder (ver AgentEngine) y el mensaje queda esperando a un agente real. `needs_support_at` queda fijo desde este momento — es contra lo que se mide el tiempo de respuesta real del equipo (ver `getSupportResponseStats`). */
export async function markConversationNeedsSupport(conversationId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE conversations SET status = 'needs_support', needs_support_at = now(), updated_at = now() WHERE id = $1 AND status = 'active'`,
    [conversationId],
  );
}

async function setConversationStatus(conversationId: string, status: Exclude<ConversationStatus, 'active' | 'needs_support'>): Promise<void> {
  const pool = getPool();
  await pool.query('UPDATE conversations SET status = $2, updated_at = now() WHERE id = $1', [conversationId, status]);
}

export const resolveConversation = (conversationId: string) => setConversationStatus(conversationId, 'resolved');
export const closeConversation = (conversationId: string) => setConversationStatus(conversationId, 'closed');
export const cancelConversation = (conversationId: string) => setConversationStatus(conversationId, 'cancelled');

export async function addSupportAgentMessage(conversationId: string, content: string): Promise<{ id: string }> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'support_agent', $2) RETURNING id`,
    [conversationId, content],
  );
  await pool.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);
  return { id: result.rows[0].id };
}

export interface SupportResponseStats {
  /** Conversaciones que pidieron soporte humano en la ventana consultada. */
  escalated: number;
  /** De esas, cuantas ya recibieron al menos una respuesta de un agente. */
  answered: number;
  /** Promedio en segundos entre pedir soporte y la primera respuesta real — null si ninguna conversacion de la ventana tiene respuesta todavia. */
  averageResponseSeconds: number | null;
}

/**
 * Pedido explicito del usuario: "verifica los tiempos en que llegan esas
 * respuestas, debe ser inmediato" — esto es lo que hace medible esa
 * afirmacion en el dashboard en vez de darla por hecho. `since` normalmente
 * es "hoy a medianoche" o "hace 7 dias" segun la ventana que pida el panel.
 */
export async function getSupportResponseStats(since: Date): Promise<SupportResponseStats> {
  const pool = getPool();
  const result = await pool.query<{ escalated: string; answered: string; avg_seconds: string | null }>(
    `SELECT
       count(*) AS escalated,
       count(*) FILTER (WHERE resp.first_reply_at IS NOT NULL) AS answered,
       avg(EXTRACT(EPOCH FROM (resp.first_reply_at - c.needs_support_at))) FILTER (WHERE resp.first_reply_at IS NOT NULL) AS avg_seconds
     FROM conversations c
     LEFT JOIN LATERAL (
       SELECT created_at AS first_reply_at FROM messages
       WHERE conversation_id = c.id AND role = 'support_agent' AND created_at > c.needs_support_at
       ORDER BY created_at ASC LIMIT 1
     ) resp ON true
     WHERE c.needs_support_at >= $1`,
    [since],
  );
  const row = result.rows[0];
  return {
    escalated: Number(row?.escalated ?? 0),
    answered: Number(row?.answered ?? 0),
    averageResponseSeconds: row?.avg_seconds !== null && row?.avg_seconds !== undefined ? Number(row.avg_seconds) : null,
  };
}

/** Cuantas conversaciones distintas recibieron al menos un mensaje de un agente humano desde `since` — el contador de "chats atendidos" del dashboard del administrador. */
export async function countConversationsHandledSince(since: Date): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ count: string }>(
    `SELECT count(DISTINCT conversation_id) FROM messages WHERE role = 'support_agent' AND created_at >= $1`,
    [since],
  );
  return Number(result.rows[0].count);
}

export interface SupportConversationSummary {
  conversationId: string;
  status: ConversationStatus;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
}

/** Bandeja de soporte (sección 41-46) — una fila por conversacion, con el ultimo mensaje como vista previa, mas reciente primero. */
export async function listSupportConversations(statuses: ConversationStatus[]): Promise<SupportConversationSummary[]> {
  const pool = getPool();
  const result = await pool.query<{
    conversation_id: string;
    status: ConversationStatus;
    last_message: string | null;
    last_message_at: Date | null;
    created_at: Date;
  }>(
    `SELECT c.id AS conversation_id, c.status, c.created_at,
            m.content AS last_message, m.created_at AS last_message_at
     FROM conversations c
     LEFT JOIN LATERAL (
       SELECT content, created_at FROM messages
       WHERE conversation_id = c.id AND role IN ('user', 'support_agent')
       ORDER BY created_at DESC LIMIT 1
     ) m ON true
     WHERE c.status = ANY($1::text[])
     ORDER BY COALESCE(m.created_at, c.created_at) DESC`,
    [statuses],
  );
  return result.rows.map((row) => ({
    conversationId: row.conversation_id,
    status: row.status,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  }));
}
