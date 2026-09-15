import { tenantHeaders } from './tenant-header';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface ApiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
}

export interface StartSessionResponse {
  sessionId: string;
  conversationId: string;
  history: ApiChatMessage[];
}

export interface PageContext {
  path?: string;
}

export interface ProductSummary {
  id: string;
  name: string;
  url: string;
  imageUrl: string | null;
  price: number;
  originalPrice: number | null;
  discountPercentage: number | null;
  installmentValue: number | null;
  installmentCount: number | null;
  currency: string;
  isOffer: boolean;
  isActive: boolean;
  categoryName: string | null;
  brandName: string | null;
  sellerName: string | null;
}

export async function startChatSession(anonymousSessionId: string, pageContext?: PageContext): Promise<StartSessionResponse> {
  const res = await fetch(`${API_BASE}/chat/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tenantHeaders() },
    body: JSON.stringify({ anonymousSessionId, pageContext }),
  });
  if (!res.ok) {
    throw new Error('No se pudo iniciar la conversación. Intenta de nuevo.');
  }
  return res.json();
}

export type ConversationStatus = 'active' | 'needs_support' | 'resolved' | 'closed' | 'cancelled';

export interface ConversationStateMessage {
  role: 'user' | 'assistant' | 'support_agent';
  content: string;
  createdAt: string;
}

export interface ConversationState {
  status: ConversationStatus | null;
  messages: ConversationStateMessage[];
}

/** El widget la consulta cada pocos segundos mientras espera soporte — trae el hilo completo (incluye respuestas de un agente humano) y el status, para detectar cuando un agente resuelve/cierra/cancela y reiniciar el chat solo. */
export async function getConversationState(conversationId: string): Promise<ConversationState> {
  const res = await fetch(`${API_BASE}/chat/status?conversationId=${conversationId}`, { headers: tenantHeaders() });
  if (!res.ok) {
    throw new Error('No se pudo consultar el estado de la conversación.');
  }
  return res.json();
}

/** Pedido explicito del usuario: calificar la atencion al final del chat — nunca bloquea el reinicio de la conversacion si falla (ver `ChatPanel`). */
export async function rateConversation(conversationId: string, rating: number, comment?: string): Promise<void> {
  await fetch(`${API_BASE}/chat/rating`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tenantHeaders() },
    body: JSON.stringify({ conversationId, rating, comment }),
  });
}

export async function startNewConversation(sessionId: string): Promise<StartSessionResponse> {
  const res = await fetch(`${API_BASE}/chat/conversations/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tenantHeaders() },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    throw new Error('No se pudo iniciar una nueva conversación.');
  }
  return res.json();
}

interface StreamPayload {
  delta?: string;
  error?: string;
  done?: boolean;
  products?: ProductSummary[];
}

/**
 * Consume el endpoint SSE de streaming del chat. Se usa fetch + ReadableStream
 * (no EventSource nativo) porque necesitamos mandar el mensaje por POST.
 */
export async function streamChatMessage(
  conversationId: string,
  message: string,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
  onProducts?: (products: ProductSummary[]) => void,
  /** Pedido explicito del usuario: la tarjeta "Problemas con tu compra o tu pedido" debe caer siempre en soporte humano, sin pasar por el clasificador de intencion. */
  forceHumanSupport?: boolean,
): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tenantHeaders() },
    body: JSON.stringify({ conversationId, message, forceHumanSupport }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error('No se pudo conectar con el asistente.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const rawEvent of events) {
      const line = rawEvent.trim();
      if (!line.startsWith('data:')) continue;

      try {
        const payload = JSON.parse(line.slice(5).trim()) as StreamPayload;
        if (payload.error) {
          onDelta(payload.error);
          return;
        }
        if (payload.delta) {
          onDelta(payload.delta);
        }
        if (payload.products?.length) {
          onProducts?.(payload.products);
        }
      } catch {
        // Fragmento incompleto entre lecturas del stream — se ignora.
      }
    }
  }
}
