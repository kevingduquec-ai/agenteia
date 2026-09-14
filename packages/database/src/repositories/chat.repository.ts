import { getPool } from '../pool.js';

export interface SessionResult {
  id: string;
}

/**
 * Un SELECT-luego-INSERT tiene una condicion de carrera real: dos llamadas
 * concurrentes con el mismo `anonymousSessionId` (ej. React StrictMode en
 * desarrollo monta el componente dos veces, o el usuario abre el widget en
 * dos pestañas a la vez) pueden ver ambas "no existe" antes de que
 * cualquiera inserte, y la segunda inserción choca contra el UNIQUE
 * constraint (verificado en vivo: `duplicate key value violates unique
 * constraint "sessions_anonymous_session_id_key"`, un 500 real para el
 * usuario). `ON CONFLICT ... DO UPDATE` hace la operacion atomica.
 */
export async function getOrCreateSession(anonymousSessionId: string, pageContext?: unknown): Promise<SessionResult> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO sessions (anonymous_session_id, page_context)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (anonymous_session_id) DO UPDATE
       SET last_active_at = now(), page_context = COALESCE($2::jsonb, sessions.page_context)
     RETURNING id`,
    [anonymousSessionId, pageContext ? JSON.stringify(pageContext) : null],
  );
  return { id: result.rows[0].id };
}

export interface ConversationResult {
  id: string;
}

/** Una sesion tiene una unica conversacion activa por ahora (alcanza para v1; el esquema soporta varias a futuro). */
export async function getOrCreateConversation(sessionId: string): Promise<ConversationResult> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM conversations WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
    [sessionId],
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id };
  }

  const insert = await pool.query<{ id: string }>('INSERT INTO conversations (session_id) VALUES ($1) RETURNING id', [
    sessionId,
  ]);
  return { id: insert.rows[0].id };
}

/** Fuerza una conversacion nueva y vacia — usado por "Nueva conversacion" en el chat. */
export async function createConversation(sessionId: string): Promise<ConversationResult> {
  const pool = getPool();
  const insert = await pool.query<{ id: string }>('INSERT INTO conversations (session_id) VALUES ($1) RETURNING id', [
    sessionId,
  ]);
  return { id: insert.rows[0].id };
}

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool' | 'support_agent';

export interface ChatMessageRow {
  role: ChatRole;
  content: string;
  createdAt: Date;
}

export async function addMessage(
  conversationId: string,
  role: ChatRole,
  content: string,
  intent?: string | null,
): Promise<{ id: string }> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    'INSERT INTO messages (conversation_id, role, content, intent) VALUES ($1, $2, $3, $4) RETURNING id',
    [conversationId, role, content, intent ?? null],
  );
  await pool.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversationId]);
  return { id: result.rows[0].id };
}

/** Contexto de pagina guardado al iniciar la sesion (sección 33-34) — se relee en cada mensaje via la conversacion en vez de guardarlo en memoria, porque una sesion puede tener varias conversaciones/pestañas y el contexto vive a nivel de sesion. */
export async function getPageContextForConversation(conversationId: string): Promise<unknown | null> {
  const pool = getPool();
  const result = await pool.query<{ page_context: unknown | null }>(
    'SELECT s.page_context FROM sessions s JOIN conversations c ON c.session_id = s.id WHERE c.id = $1',
    [conversationId],
  );
  return result.rows[0]?.page_context ?? null;
}

export async function getRecentMessages(conversationId: string, limit = 12): Promise<ChatMessageRow[]> {
  const pool = getPool();
  const result = await pool.query<{ role: ChatRole; content: string; created_at: Date }>(
    `SELECT role, content, created_at FROM messages
     WHERE conversation_id = $1 AND role IN ('user', 'assistant')
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, limit],
  );
  return result.rows
    .reverse()
    .map((row) => ({ role: row.role, content: row.content, createdAt: row.created_at }));
}

/** Historial completo visible para el cliente final, incluyendo respuestas de un agente humano — a diferencia de `getRecentMessages` (que solo trae user/assistant para alimentar el contexto del LLM), esta se usa para pintar el chat y para el polling que detecta respuestas nuevas de soporte. */
export async function getFullConversationThread(conversationId: string): Promise<ChatMessageRow[]> {
  const pool = getPool();
  const result = await pool.query<{ role: ChatRole; content: string; created_at: Date }>(
    `SELECT role, content, created_at FROM messages
     WHERE conversation_id = $1 AND role IN ('user', 'assistant', 'support_agent')
     ORDER BY created_at ASC`,
    [conversationId],
  );
  return result.rows.map((row) => ({ role: row.role, content: row.content, createdAt: row.created_at }));
}
