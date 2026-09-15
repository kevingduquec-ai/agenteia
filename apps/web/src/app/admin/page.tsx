'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminUnauthorizedError,
  adminLogout,
  checkAdminSession,
  getIntentBreakdown,
  getOverview,
  getSupportStats,
  getTopProducts,
  getUnmetDemand,
  type AdminOverview,
  type AdminRole,
  type IntentBreakdownRow,
  type SupportStats,
  type TopProduct,
  type UnmetDemandRow,
} from '@/lib/admin-api';

const REFRESH_MS = 15_000;

const INTENT_LABELS: Record<string, string> = {
  PRODUCT_SEARCH: 'Búsqueda de producto',
  BUDGET_SEARCH: 'Búsqueda por presupuesto',
  INSTALLMENT_SEARCH: 'Búsqueda por cuota',
  PRODUCT_COMPARISON: 'Comparación',
  PRODUCT_QUESTION: 'Pregunta de producto',
  PRODUCT_RECOMMENDATION: 'Recomendación',
  SIMILAR_PRODUCT: 'Productos similares',
  CHEAPER_ALTERNATIVE: 'Alternativa más económica',
  GIFT_RECOMMENDATION: 'Regalo',
  FAQ: 'Preguntas frecuentes',
  CREDIT_INFORMATION: 'Crédito ACR',
  WARRANTY_INFORMATION: 'Garantía',
  RETURN_INFORMATION: 'Devoluciones',
  HUMAN_SUPPORT: 'Soporte humano',
  PRIVATE_CUSTOMER_DATA: 'Datos de cuenta',
  GENERAL_CHAT: 'Charla general',
  UNKNOWN: 'Fuera de tema',
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [role, setRole] = useState<AdminRole | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [unmetDemand, setUnmetDemand] = useState<UnmetDemandRow[]>([]);
  const [intentBreakdown, setIntentBreakdown] = useState<IntentBreakdownRow[]>([]);
  const [supportStats, setSupportStats] = useState<SupportStats | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [overviewData, productsData, demandData, intentData, supportData] = await Promise.all([
        getOverview(),
        getTopProducts(),
        getUnmetDemand(),
        getIntentBreakdown(),
        getSupportStats(),
      ]);
      setOverview(overviewData);
      setTopProducts(productsData);
      setUnmetDemand(demandData);
      setIntentBreakdown(intentData);
      setSupportStats(supportData);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      if (err instanceof AdminUnauthorizedError) {
        router.push('/admin/login');
        return;
      }
      setError('No pudimos cargar las estadísticas. Reintentando…');
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const role = await checkAdminSession();
      if (cancelled) return;
      if (!role) {
        router.push('/admin/login');
        return;
      }
      // El rol "soporte" nunca ve dashboards/analitica — solo la bandeja.
      if (role === 'soporte') {
        router.push('/admin/support');
        return;
      }
      setRole(role);
      setCheckingAuth(false);
      await loadAll();
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [router, loadAll]);

  useEffect(() => {
    if (checkingAuth) return;
    const interval = setInterval(loadAll, REFRESH_MS);
    return () => clearInterval(interval);
  }, [checkingAuth, loadAll]);

  async function handleLogout() {
    await adminLogout();
    router.push('/admin/login');
  }

  if (checkingAuth) {
    return <div className="grid h-full place-items-center text-slate-400">Verificando sesión…</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="bg-gradient-to-r from-violet-700 to-fuchsia-600 bg-clip-text text-2xl font-bold text-transparent">
            Panel admin
          </h1>
          <p className="text-sm text-slate-500">
            {lastUpdated ? `Actualizado a las ${lastUpdated.toLocaleTimeString('es-CO')}` : 'Cargando…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {role === 'owner' && (
            <>
              <Link
                href="/admin/tenants"
                className="rounded-full border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-50"
              >
                Clientes
              </Link>
              <Link
                href="/admin/impact"
                className="rounded-full border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-50"
              >
                Impacto
              </Link>
              <Link
                href="/admin/users"
                className="rounded-full border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-50"
              >
                Usuarios
              </Link>
            </>
          )}
          <Link
            href="/admin/support"
            className="rounded-full border border-violet-200 bg-white px-4 py-2 text-sm font-medium text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-50"
          >
            Bandeja de soporte
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      {error && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Visitantes en vivo" value={overview?.liveVisitors} live />
        <StatCard label="Conversaciones hoy" value={overview?.conversationsToday} />
        <StatCard label="Mensajes hoy" value={overview?.messagesToday} />
        <StatCard label="Conversaciones totales" value={overview?.totalConversations} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Productos más consultados" subtitle="Últimos 7 días">
          {topProducts.length === 0 ? (
            <EmptyState text="Todavía no hay suficientes conversaciones con productos." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {topProducts.map((product, index) => (
                <li key={product.productId} className="flex items-center gap-3 py-2.5">
                  <span className="w-5 shrink-0 text-center text-sm font-semibold text-slate-300">{index + 1}</span>
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- imagenes externas del marketplace
                    <img src={product.imageUrl} alt={product.name} className="h-10 w-10 shrink-0 rounded-lg border border-slate-100 object-contain" />
                  ) : (
                    <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{product.name}</p>
                    <p className="text-xs text-slate-400">{formatCOP(product.price)}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
                    {product.impressions} {product.impressions === 1 ? 'vista' : 'vistas'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Demanda no atendida" subtitle="Lo que buscan y no tenemos — últimos 30 días">
          {unmetDemand.length === 0 ? (
            <EmptyState text="Sin demanda insatisfecha registrada todavía." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {unmetDemand.map((row, index) => (
                <li key={`${row.requestedCategory}-${row.requestedBrand}-${index}`} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {[row.requestedCategory, row.requestedBrand].filter(Boolean).join(' · ') || 'Sin categoría/marca detectada'}
                    </p>
                    <p className="truncate text-xs text-slate-400">&ldquo;{row.sampleQuery}&rdquo;</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    {row.count} {row.count === 1 ? 'vez' : 'veces'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="De qué habla la gente" subtitle="Intenciones detectadas — últimos 7 días">
          {intentBreakdown.length === 0 ? (
            <EmptyState text="Sin conversaciones registradas todavía." />
          ) : (
            <IntentBars rows={intentBreakdown} />
          )}
        </Panel>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Soporte humano hoy" subtitle="Se actualiza solo, cada pocos segundos">
          <SupportStatsView stats={supportStats} />
        </Panel>
        <Panel title="Calificación de la atención" subtitle="Lo que califican tus compradores al terminar el chat — hoy">
          <RatingView rating={supportStats?.rating ?? null} />
        </Panel>
      </div>

      <div className="mt-6">
        <EmbedSnippet />
      </div>
    </div>
  );
}

function EmbedSnippet() {
  const [copied, setCopied] = useState(false);
  // embed.js vive en apps/web (esta misma app), NUNCA en la API — usar
  // NEXT_PUBLIC_API_URL aqui daba un enlace roto en producción, donde
  // apps/web y apps/api viven en dominios distintos (ver docs/DEPLOYMENT.md).
  // window.location.origin es siempre el dominio correcto porque este panel
  // se sirve desde la misma app que sirve /embed.js.
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const snippet = `<script src="${origin || 'https://TU-DOMINIO'}/embed.js" defer></script>`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard no disponible — el usuario puede seleccionar el texto a mano */
    }
  }

  return (
    <Panel title="Instalar el chat en tu marketplace" subtitle="Copia y pega esta línea antes de </body> — aparece como un círculo de chat en la esquina inferior derecha">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <code className="flex-1 overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 text-xs text-emerald-300 sm:text-sm">{snippet}</code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-violet-300/50 transition hover:shadow-lg"
        >
          {copied ? '¡Copiado!' : 'Copiar'}
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        No necesitas tocar tu servidor ni tu código más allá de pegar esta línea una sola vez — el chat se actualiza solo cuando publicamos mejoras.
      </p>
    </Panel>
  );
}

function StatCard({ label, value, live }: { label: string; value: number | undefined; live?: boolean }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />}
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value ?? '—'}</p>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="text-xs text-slate-400">{subtitle}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-slate-400">{text}</p>;
}

function IntentBars({ rows }: { rows: IntentBreakdownRow[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.intent} className="flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-sm text-slate-600">{INTENT_LABELS[row.intent] ?? row.intent}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
              style={{ width: `${Math.max((row.count / max) * 100, 4)}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-sm font-semibold text-slate-700">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Pedido explicito del usuario: mostrar cuantos chats atendio soporte y
 * verificar que la respuesta llegue rapido — el semaforo de color hace que
 * un tiempo de respuesta lento salte a la vista sin tener que interpretar
 * el numero.
 */
function SupportStatsView({ stats }: { stats: SupportStats | null }) {
  if (!stats) {
    return <EmptyState text="Cargando…" />;
  }
  if (stats.escalatedToday === 0) {
    return <EmptyState text="Nadie ha pedido soporte humano todavía hoy." />;
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <MiniStat label="Chats atendidos hoy" value={String(stats.handledToday)} />
      <MiniStat label="Solicitudes de soporte hoy" value={String(stats.escalatedToday)} />
      <MiniStat
        label="Tiempo de respuesta"
        value={formatResponseTime(stats.averageResponseSeconds)}
        tone={responseTimeTone(stats.averageResponseSeconds)}
      />
      <MiniStat label="Ya respondidos" value={`${stats.answeredToday}/${stats.escalatedToday}`} />
    </div>
  );
}

function MiniStat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-600'
      : tone === 'warn'
        ? 'text-amber-600'
        : tone === 'bad'
          ? 'text-rose-600'
          : 'text-slate-900';
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-0.5 text-xl font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

/** Menos de 2 minutos se siente "inmediato" para quien esta esperando; mas de 10 ya es una demora real — pedido explicito del usuario de que la respuesta "debe ser inmediato". */
function responseTimeTone(seconds: number | null): 'default' | 'good' | 'warn' | 'bad' {
  if (seconds === null) return 'default';
  if (seconds <= 120) return 'good';
  if (seconds <= 600) return 'warn';
  return 'bad';
}

function formatResponseTime(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function RatingView({ rating }: { rating: SupportStats['rating'] | null }) {
  if (!rating || rating.count === 0) {
    return <EmptyState text="Todavía no hay calificaciones hoy." />;
  }
  const maxCount = Math.max(...Object.values(rating.distribution), 1);
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-slate-900">{rating.average?.toFixed(1)}</span>
        <span className="text-sm text-slate-400">/ 5 · {rating.count} {rating.count === 1 ? 'calificación' : 'calificaciones'}</span>
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {([5, 4, 3, 2, 1] as const).map((stars) => {
          const count = rating.distribution[String(stars) as '1' | '2' | '3' | '4' | '5'] ?? 0;
          return (
            <li key={stars} className="flex items-center gap-2 text-xs text-slate-500">
              <span className="w-8 shrink-0">{stars}★</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${(count / maxCount) * 100}%` }} />
              </div>
              <span className="w-5 shrink-0 text-right">{count}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount);
}
