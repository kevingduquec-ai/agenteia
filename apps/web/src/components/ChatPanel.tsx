'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getConversationState,
  rateConversation,
  startChatSession,
  startNewConversation,
  streamChatMessage,
  type ConversationStatus,
  type PageContext,
} from '@/lib/api';
import { getOrCreateAnonymousSessionId } from '@/lib/session';
import type { OrbState } from './ChatOrb';
import { MessageBubble, type DisplayMessage } from './MessageBubble';
import { QuickActions } from './QuickActions';
import { RatingPrompt } from './RatingPrompt';

// Mientras espera soporte, el widget consulta el estado de la conversacion
// cada pocos segundos — asi ve respuestas nuevas de un agente humano y
// detecta cuando resuelve/cierra/cancela sin necesitar un WebSocket.
const STATUS_POLL_MS = 6_000;

const STATUS_RESET_MESSAGE: Record<'resolved' | 'closed' | 'cancelled', string> = {
  resolved: 'Un agente marcó tu consulta como resuelta. Iniciando una nueva conversación…',
  closed: 'Un agente cerró esta conversación. Iniciando una nueva…',
  cancelled: 'Esta conversación fue cancelada. Iniciando una nueva…',
};

// El orbe 3D solo puede vivir en el navegador (usa WebGL) — se carga sin
// SSR para evitar cualquier intento de renderizarlo en el servidor.
const ChatOrb = dynamic(() => import('./ChatOrb').then((mod) => mod.ChatOrb), {
  ssr: false,
  loading: () => <div className="h-24 w-24 sm:h-28 sm:w-28" aria-hidden="true" />,
});

let messageCounter = 0;
function nextId(): string {
  messageCounter += 1;
  return `m${messageCounter}-${Date.now()}`;
}

export interface ChatPanelProps {
  pageContext?: PageContext;
}

export function ChatPanel({ pageContext }: ChatPanelProps = {}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [isBusy, setIsBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [isEmbedded, setIsEmbedded] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [ratingPrompt, setRatingPrompt] = useState<{ conversationId: string; notice?: string } | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const lastKnownMessageCount = useRef(0);

  useEffect(() => {
    // Si el chat vive dentro del <iframe> del widget (embed.js), mostramos
    // un boton para cerrarlo — en la pagina completa no aplica.
    try {
      setIsEmbedded(window.self !== window.top);
    } catch {
      setIsEmbedded(true); // acceso a window.top bloqueado por el navegador = casi seguro estamos en un iframe cross-origin
    }

    let cancelled = false;
    async function init() {
      try {
        const anonymousSessionId = getOrCreateAnonymousSessionId();
        const session = await startChatSession(anonymousSessionId, pageContext);
        if (cancelled) return;
        setSessionId(session.sessionId);
        setConversationId(session.conversationId);
        lastKnownMessageCount.current = session.history.length;
        setMessages(
          session.history.map((entry) => ({
            id: nextId(),
            role: entry.role,
            content: entry.content,
          })),
        );
        setReady(true);
      } catch {
        if (!cancelled) {
          setConnectionError('No pudimos conectar con Prefi. Verifica tu conexión e intenta de nuevo.');
        }
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  async function handleSend(rawText: string, forceHumanSupport?: boolean) {
    const text = rawText.trim();
    if (!text || !conversationId || isBusy) {
      return;
    }

    setConnectionError(null);
    setInput('');
    setIsBusy(true);
    setOrbState('thinking');

    const userMessage: DisplayMessage = { id: nextId(), role: 'user', content: text };
    const assistantId = nextId();
    setMessages((prev) => [...prev, userMessage, { id: assistantId, role: 'assistant', content: '', pending: true }]);
    // Mantiene el conteo en sincronia con lo que el proximo poll de estado
    // va a ver en el servidor — sin esto, el primer poll despues de cada
    // mensaje reemplazaria toda la lista con IDs nuevos y reiniciaria la
    // animacion de entrada de todos los mensajes, no solo el nuevo.
    lastKnownMessageCount.current += 2;

    let firstTokenReceived = false;

    try {
      await streamChatMessage(
        conversationId,
        text,
        (delta) => {
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            setOrbState('speaking');
          }
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)));
        },
        undefined,
        (products) => {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, products } : m)));
        },
        forceHumanSupport,
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: 'No pude conectarme para responder. Intenta de nuevo en un momento.', pending: false }
            : m,
        ),
      );
    } finally {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)));
      setIsBusy(false);
      setOrbState('idle');
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    handleSend(input);
  }

  const performReset = useCallback(
    async (notice?: string) => {
      if (!sessionId) return;
      try {
        const conversation = await startNewConversation(sessionId);
        lastKnownMessageCount.current = 0;
        setConversationId(conversation.conversationId);
        setMessages([]);
        setConnectionError(null);
        setOrbState('idle');
        setRatingPrompt(null);
        if (notice) {
          setStatusNotice(notice);
          setTimeout(() => setStatusNotice(null), 5000);
        }
      } catch {
        setConnectionError('No pudimos empezar una conversación nueva. Intenta de nuevo.');
      }
    },
    [sessionId],
  );

  // Pedido explicito del usuario: calificar la atencion. El unico momento
  // en que "la atencion terminó" es un hecho claro es justo antes de
  // reiniciar la conversacion — asi que se intercepta aqui en vez de en un
  // punto arbitrario a mitad de un chat todavia activo. Si el comprador
  // nunca escribió nada (sesion vacia que se reinicia sola), no hay nada
  // que calificar y se salta directo al reinicio.
  const resetConversation = useCallback(
    async (notice?: string) => {
      if (!sessionId) return;
      const hasRatableConversation = conversationId && messagesRef.current.some((m) => m.role === 'user');
      if (hasRatableConversation) {
        setRatingPrompt({ conversationId, notice });
        return;
      }
      await performReset(notice);
    },
    [sessionId, conversationId, performReset],
  );

  async function handleRatingSubmit(rating: number, comment?: string) {
    if (!ratingPrompt) return;
    try {
      await rateConversation(ratingPrompt.conversationId, rating, comment);
    } catch {
      // El envio de la calificacion es best-effort — nunca debe bloquear que el chat se reinicie.
    }
    await performReset(ratingPrompt.notice);
  }

  function handleRatingSkip() {
    if (!ratingPrompt) return;
    void performReset(ratingPrompt.notice);
  }

  async function handleNewConversation() {
    if (!sessionId || isBusy) return;
    await resetConversation();
  }

  // Soporte humano: mientras se espera respuesta, se consulta el estado de
  // la conversacion — trae mensajes nuevos de un agente y detecta cuando
  // resuelve/cierra/cancela para reiniciar el chat del cliente solo (pedido
  // explicito del usuario).
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;

    async function poll() {
      try {
        const state = await getConversationState(conversationId!);
        if (cancelled || isBusyRef.current) return;

        if (state.messages.length !== lastKnownMessageCount.current) {
          lastKnownMessageCount.current = state.messages.length;
          setMessages(
            state.messages.map((entry) => ({
              id: nextId(),
              role: entry.role,
              content: entry.content,
            })),
          );
        }

        const finalStatuses: ConversationStatus[] = ['resolved', 'closed', 'cancelled'];
        if (state.status && finalStatuses.includes(state.status)) {
          await resetConversation(STATUS_RESET_MESSAGE[state.status as 'resolved' | 'closed' | 'cancelled']);
        }
      } catch {
        // Poll silencioso — un fallo puntual no debe interrumpir el chat.
      }
    }

    const interval = setInterval(poll, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [conversationId, resetConversation]);

  function handleClose() {
    window.parent.postMessage({ type: 'prefiero-ia:close' }, '*');
  }

  const showEmptyState = ready && messages.length === 0;

  return (
    <div className="flex h-dvh w-full flex-col bg-gradient-to-b from-violet-50 via-white to-white">
      <div className="flex shrink-0 items-center justify-end gap-1 px-3 pt-3">
        <button
          type="button"
          onClick={handleNewConversation}
          disabled={!sessionId || isBusy}
          aria-label="Nueva conversación"
          title="Nueva conversación"
          className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition duration-150 hover:rotate-[-45deg] hover:bg-violet-100 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:rotate-0"
        >
          <RestartIcon />
        </button>
        {isEmbedded && (
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar chat"
            title="Cerrar"
            className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition duration-150 hover:bg-rose-50 hover:text-rose-600"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <header className="flex shrink-0 flex-col items-center gap-1 border-b border-violet-100/70 px-4 pb-3 pt-1 text-center sm:gap-2 sm:pb-4">
        <ChatOrb state={orbState} />
        <h1 className="bg-gradient-to-r from-violet-700 to-fuchsia-600 bg-clip-text text-lg font-bold text-transparent sm:text-2xl">
          Prefi
        </h1>
        <p className="max-w-sm text-xs text-slate-500 sm:text-sm">Tu agente inteligente de compras en Prefiero ACR+</p>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-y-auto px-3 sm:px-4">
        {connectionError && (
          <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {connectionError}
          </div>
        )}
        {statusNotice && (
          <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {statusNotice}
          </div>
        )}

        {ratingPrompt ? (
          <div className="flex flex-1 items-center justify-center py-4">
            <RatingPrompt onSubmit={handleRatingSubmit} onSkip={handleRatingSkip} />
          </div>
        ) : showEmptyState ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-4 text-center">
            <div>
              <p className="text-base font-semibold text-slate-800 sm:text-lg">¿Qué estás buscando hoy?</p>
              <p className="mt-1 text-sm text-slate-500">
                Cuéntame qué necesitas, con tus propias palabras — yo me encargo del resto.
              </p>
            </div>
            <QuickActions onSelect={handleSend} disabled={isBusy || !conversationId} />
          </div>
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto py-4">
            {messages.map((message) => (
              <div key={message.id} className="animate-message-in">
                <MessageBubble message={message} />
              </div>
            ))}
            <div ref={scrollAnchorRef} />
          </div>
        )}
      </main>

      {!ratingPrompt && (
        <form onSubmit={handleSubmit} className="sticky bottom-0 border-t border-violet-100 bg-white/90 px-3 py-3 backdrop-blur sm:px-4">
          <div className="mx-auto flex w-full max-w-2xl items-end gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                const isEnter = event.key === 'Enter' || event.keyCode === 13;
                if (isEnter && !event.shiftKey) {
                  event.preventDefault();
                  handleSend(input);
                }
              }}
              placeholder="Escribe tu pregunta aquí…"
              rows={1}
              disabled={!conversationId || isBusy}
              className="h-12 max-h-32 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 leading-[1.4] text-[15px] text-slate-800 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-200 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!conversationId || isBusy || !input.trim()}
              aria-label="Enviar mensaje"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-md shadow-violet-300/50 transition duration-150 hover:scale-105 hover:shadow-lg hover:shadow-violet-300/60 active:scale-95 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none disabled:hover:scale-100"
            >
              <SendIcon />
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-2xl text-center text-xs text-slate-400">
            Prefi puede cometer errores. Verifica precios y condiciones importantes antes de comprar.
          </p>
        </form>
      )}
    </div>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={20} height={20}>
      <path d="M4 12h16" />
      <path d="m13 5 7 7-7 7" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={16} height={16}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={16} height={16}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
