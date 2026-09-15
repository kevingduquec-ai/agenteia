import { getPool } from '../pool.js';
import { getRatingSummary } from './feedback.repository.js';
import { getSupportResponseStats } from './support.repository.js';

/**
 * Marca la sesion como activa "ahora" — se llama en cada mensaje (no solo
 * al abrir el chat) para que "visitantes en vivo" (sección 41-46) refleje
 * quien esta conversando de verdad, no solo quien cargo la pagina alguna
 * vez.
 */
export async function touchSessionByConversationId(conversationId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE sessions SET last_active_at = now()
     WHERE id = (SELECT session_id FROM conversations WHERE id = $1)`,
    [conversationId],
  );
}

export async function recordProductImpressions(
  tenantId: string,
  conversationId: string | null | undefined,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) {
    return;
  }
  const pool = getPool();
  const values: string[] = [];
  const params: unknown[] = [];
  productIds.forEach((productId) => {
    params.push(tenantId, productId, conversationId ?? null);
    values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length})`);
  });
  await pool.query(`INSERT INTO product_impressions (tenant_id, product_id, conversation_id) VALUES ${values.join(', ')}`, params);
}

export interface SearchEventInput {
  conversationId?: string | null;
  query: string;
  intent?: string | null;
  resultCount: number;
}

export async function recordSearchEvent(tenantId: string, input: SearchEventInput): Promise<void> {
  const pool = getPool();
  await pool.query(
    'INSERT INTO search_events (tenant_id, conversation_id, query, intent, result_count) VALUES ($1, $2, $3, $4, $5)',
    [tenantId, input.conversationId ?? null, input.query, input.intent ?? null, input.resultCount],
  );
}

/** "En vivo" = una sesion de ESTE tenant con actividad en los ultimos `minutes` minutos. */
export async function countLiveVisitors(tenantId: string, minutes = 5): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ count: string }>(
    `SELECT count(*) FROM sessions WHERE tenant_id = $1 AND last_active_at > now() - ($2 || ' minutes')::interval`,
    [tenantId, minutes],
  );
  return Number(result.rows[0].count);
}

export interface TopProductRow {
  productId: string;
  name: string;
  price: number;
  imageUrl: string | null;
  impressions: number;
}

export async function getTopConsultedProducts(tenantId: string, limit = 10, days = 7): Promise<TopProductRow[]> {
  const pool = getPool();
  const result = await pool.query<{ product_id: string; name: string; price: string; image_url: string | null; impressions: string }>(
    `SELECT pi.product_id, p.name, p.price, p.image_url, count(*) AS impressions
     FROM product_impressions pi
     JOIN products p ON p.id = pi.product_id
     WHERE pi.tenant_id = $1 AND pi.created_at > now() - ($3 || ' days')::interval
     GROUP BY pi.product_id, p.name, p.price, p.image_url
     ORDER BY impressions DESC
     LIMIT $2`,
    [tenantId, limit, days],
  );
  return result.rows.map((row) => ({
    productId: row.product_id,
    name: row.name,
    price: Number(row.price),
    imageUrl: row.image_url,
    impressions: Number(row.impressions),
  }));
}

export interface UnmetDemandSummaryRow {
  requestedCategory: string | null;
  requestedBrand: string | null;
  count: number;
  sampleQuery: string;
}

/** Agrupa por categoria+marca pedida — el "lo que buscan y no tenemos" de la sección 41-46, para que el dueño del marketplace sepa que le falta al catalogo. */
export async function getUnmetDemandSummary(tenantId: string, limit = 10, days = 30): Promise<UnmetDemandSummaryRow[]> {
  const pool = getPool();
  const result = await pool.query<{ requested_category: string | null; requested_brand: string | null; count: string; sample_query: string }>(
    `SELECT requested_category, requested_brand, count(*) AS count, (array_agg(query ORDER BY created_at DESC))[1] AS sample_query
     FROM unmet_demands
     WHERE tenant_id = $1 AND created_at > now() - ($3 || ' days')::interval
     GROUP BY requested_category, requested_brand
     ORDER BY count DESC
     LIMIT $2`,
    [tenantId, limit, days],
  );
  return result.rows.map((row) => ({
    requestedCategory: row.requested_category,
    requestedBrand: row.requested_brand,
    count: Number(row.count),
    sampleQuery: row.sample_query,
  }));
}

export interface ConversationOverview {
  totalSessions: number;
  totalConversations: number;
  totalMessages: number;
  conversationsToday: number;
  messagesToday: number;
}

export async function getConversationOverview(tenantId: string): Promise<ConversationOverview> {
  const pool = getPool();
  const result = await pool.query<{
    total_sessions: string;
    total_conversations: string;
    total_messages: string;
    conversations_today: string;
    messages_today: string;
  }>(
    `SELECT
      (SELECT count(*) FROM sessions WHERE tenant_id = $1) AS total_sessions,
      (SELECT count(*) FROM conversations WHERE tenant_id = $1) AS total_conversations,
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.tenant_id = $1 AND m.role IN ('user', 'assistant')) AS total_messages,
      (SELECT count(*) FROM conversations WHERE tenant_id = $1 AND created_at > date_trunc('day', now())) AS conversations_today,
      (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE c.tenant_id = $1 AND m.role IN ('user', 'assistant') AND m.created_at > date_trunc('day', now())) AS messages_today
    `,
    [tenantId],
  );
  const row = result.rows[0];
  return {
    totalSessions: Number(row.total_sessions),
    totalConversations: Number(row.total_conversations),
    totalMessages: Number(row.total_messages),
    conversationsToday: Number(row.conversations_today),
    messagesToday: Number(row.messages_today),
  };
}

export interface ImpactReport {
  conversations: number;
  customerMessages: number;
  /** Preguntas fuera de tema que el enrutador de intencion corto sin gastar una respuesta completa de IA — la prueba concreta del ahorro de costo (pedido explicito del usuario: "que me permita demostrarle a Prefiero que tan importante fue Prefi"). */
  offTopicDeflected: number;
  supportEscalations: number;
  averageSupportResponseSeconds: number | null;
  averageRating: number | null;
  ratingCount: number;
  /** Categorias/marcas que se pidieron y el catalogo no tiene — oportunidades de venta concretas detectadas, no una cifra generica. */
  unmetDemandSignals: number;
}

/**
 * Reporte de impacto para el dueño del marketplace (pedido explicito del
 * usuario) — junta metricas que ya existian por separado en una sola
 * consulta pensada para responder "que tan importante fue Prefi esta
 * semana/mes/año", no solo "cuantos mensajes hubo". `days` es la ventana
 * (7, 30 o 365 en el panel del owner). El owner elige de que tenant
 * quiere este reporte — nunca se agrega entre todos los clientes.
 */
export async function getImpactReport(tenantId: string, days: number): Promise<ImpactReport> {
  const pool = getPool();
  const result = await pool.query<{
    conversations: string;
    customer_messages: string;
    off_topic_deflected: string;
    support_escalations: string;
    unmet_demand_signals: string;
  }>(
    `SELECT
       (SELECT count(*) FROM conversations WHERE tenant_id = $1 AND created_at > now() - ($2 || ' days')::interval) AS conversations,
       (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.tenant_id = $1 AND m.role = 'user' AND m.created_at > now() - ($2 || ' days')::interval) AS customer_messages,
       (SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.tenant_id = $1 AND m.role = 'assistant' AND m.intent = 'UNKNOWN' AND m.created_at > now() - ($2 || ' days')::interval) AS off_topic_deflected,
       (SELECT count(*) FROM conversations WHERE tenant_id = $1 AND needs_support_at > now() - ($2 || ' days')::interval) AS support_escalations,
       (SELECT count(*) FROM unmet_demands WHERE tenant_id = $1 AND created_at > now() - ($2 || ' days')::interval) AS unmet_demand_signals`,
    [tenantId, days],
  );
  const row = result.rows[0];

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [responseStats, ratingSummary] = await Promise.all([
    getSupportResponseStats(tenantId, since),
    getRatingSummary(tenantId, since),
  ]);

  return {
    conversations: Number(row.conversations),
    customerMessages: Number(row.customer_messages),
    offTopicDeflected: Number(row.off_topic_deflected),
    supportEscalations: Number(row.support_escalations),
    averageSupportResponseSeconds: responseStats.averageResponseSeconds,
    averageRating: ratingSummary.average,
    ratingCount: ratingSummary.count,
    unmetDemandSignals: Number(row.unmet_demand_signals),
  };
}

export interface IntentBreakdownRow {
  intent: string;
  count: number;
}

export async function getIntentBreakdown(tenantId: string, days = 7): Promise<IntentBreakdownRow[]> {
  const pool = getPool();
  const result = await pool.query<{ intent: string; count: string }>(
    `SELECT m.intent, count(*) AS count
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.tenant_id = $1 AND m.role = 'assistant' AND m.intent IS NOT NULL AND m.created_at > now() - ($2 || ' days')::interval
     GROUP BY m.intent
     ORDER BY count DESC`,
    [tenantId, days],
  );
  return result.rows.map((row) => ({ intent: row.intent, count: Number(row.count) }));
}
