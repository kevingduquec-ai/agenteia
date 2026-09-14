'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdminUnauthorizedError,
  adminLogout,
  cancelSupportConversation,
  checkAdminSession,
  closeSupportConversation,
  getSupportMessages,
  listSupportConversations,
  replyToSupportConversation,
  resolveSupportConversation,
  type AdminRole,
  type SupportConversationSummary,
  type SupportMessage,
} from '@/lib/admin-api';

const LIST_REFRESH_MS = 8_000;
const THREAD_REFRESH_MS = 5_000;

export default function SupportInboxPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [role, setRole] = useState<AdminRole | null>(null);
  const [tickets, setTickets] = useState<SupportConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  const loadTickets = useCallback(async () => {
    try {
      const data = await listSupportConversations('needs_support');
      setTickets(data);
    } catch (err) {
      if (err instanceof AdminUnauthorizedError) {
        router.push('/admin/login');
      }
    }
  }, [router]);

  const loadThread = useCallback(
    async (conversationId: string) => {
      try {
        const data = await getSupportMessages(conversationId);
        setMessages(data);
      } catch (err) {
        if (err instanceof AdminUnauthorizedError) {
          router.push('/admin/login');
        }
      }
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const sessionRole = await checkAdminSession();
      if (cancelled) return;
      if (!sessionRole) {
        router.push('/admin/login');
        return;
      }
      setRole(sessionRole);
      setCheckingAuth(false);
      await loadTickets();
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [router, loadTickets]);

  useEffect(() => {
    if (checkingAuth) return;
    const interval = setInterval(loadTickets, LIST_REFRESH_MS);
    return () => clearInterval(interval);
  }, [checkingAuth, loadTickets]);

  useEffect(() => {
    if (!selectedId) return;
    loadThread(selectedId);
    const interval = setInterval(() => loadThread(selectedId), THREAD_REFRESH_MS);
    return () => clearInterval(interval);
  }, [selectedId, loadThread]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  async function handleReply(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId || !reply.trim() || isSending) return;
    setIsSending(true);
    try {
      await replyToSupportConversation(selectedId, reply.trim());
      setReply('');
      await loadThread(selectedId);
    } finally {
      setIsSending(false);
    }
  }

  async function handleAction(action: 'resolve' | 'close' | 'cancel') {
    if (!selectedId || isActing) return;
    setIsActing(true);
    try {
      const fn = action === 'resolve' ? resolveSupportConversation : action === 'close' ? closeSupportConversation : cancelSupportConversation;
      await fn(selectedId);
      setSelectedId(null);
      setMessages([]);
      await loadTickets();
    } finally {
      setIsActing(false);
    }
  }

  async function handleLogout() {
    await adminLogout();
    router.push('/admin/login');
  }

  if (checkingAuth) {
    return <div className="grid h-full place-items-center text-slate-400">Verificando sesión…</div>;
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="bg-gradient-to-r from-violet-700 to-fuchsia-600 bg-clip-text text-2xl font-bold text-transparent">
            Bandeja de soporte
          </h1>
          <p className="text-sm text-slate-500">{tickets.length} conversación(es) esperando respuesta</p>
        </div>
        <div className="flex items-center gap-2">
          {role === 'admin' && (
            <Link
              href="/admin"
              className="rounded-full border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-50"
            >
              Ver dashboard
            </Link>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      <div className="mt-6 grid flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[300px_1fr]">
        <div className="overflow-y-auto rounded-2xl border border-violet-100 bg-white">
          {tickets.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">No hay conversaciones esperando respuesta 🎉</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tickets.map((ticket) => (
                <li key={ticket.conversationId}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(ticket.conversationId)}
                    className={`block w-full px-4 py-3 text-left transition hover:bg-violet-50 ${
                      selectedId === ticket.conversationId ? 'bg-violet-50' : ''
                    }`}
                  >
                    <p className="truncate text-sm font-medium text-slate-800">{ticket.lastMessage || 'Sin mensajes aún'}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {ticket.lastMessageAt ? new Date(ticket.lastMessageAt).toLocaleString('es-CO') : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col overflow-hidden rounded-2xl border border-violet-100 bg-white">
          {!selectedId ? (
            <div className="grid flex-1 place-items-center text-sm text-slate-400">Selecciona una conversación</div>
          ) : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.map((message, index) => (
                  <SupportMessageBubble key={index} message={message} />
                ))}
                <div ref={scrollAnchorRef} />
              </div>

              <div className="flex items-center gap-2 border-t border-violet-100 px-4 py-3">
                <button
                  type="button"
                  disabled={isActing}
                  onClick={() => handleAction('resolve')}
                  className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                >
                  Resolver
                </button>
                <button
                  type="button"
                  disabled={isActing}
                  onClick={() => handleAction('close')}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  disabled={isActing}
                  onClick={() => handleAction('cancel')}
                  className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <span className="ml-auto text-xs text-slate-400">Cualquiera de estas reinicia el chat del cliente</span>
              </div>

              <form onSubmit={handleReply} className="flex items-end gap-2 border-t border-violet-100 p-3">
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="Escribe tu respuesta…"
                  rows={2}
                  className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[15px] outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-200"
                />
                <button
                  type="submit"
                  disabled={isSending || !reply.trim()}
                  className="h-11 shrink-0 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 px-5 text-sm font-medium text-white shadow-md shadow-violet-300/50 transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Enviar
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SupportMessageBubble({ message }: { message: SupportMessage }) {
  const isAgent = message.role === 'support_agent';
  const isAi = message.role === 'assistant';
  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full ${isUser ? 'justify-start' : 'justify-end'}`}>
      <div className="max-w-[75%]">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          {isUser ? 'Cliente' : isAgent ? 'Agente de soporte' : isAi ? 'Prefi' : message.role}
        </p>
        <div
          className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
            isUser
              ? 'rounded-tl-md bg-slate-100 text-slate-800'
              : isAgent
                ? 'rounded-tr-md bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white'
                : 'rounded-tr-md border border-violet-100 bg-violet-50 text-slate-600'
          }`}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}
