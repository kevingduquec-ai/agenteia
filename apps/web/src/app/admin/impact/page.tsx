'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminUnauthorizedError,
  checkAdminSession,
  getImpactReport,
  getSystemHealth,
  type ImpactReport,
  type ImpactWindow,
  type SystemHealth,
} from '@/lib/admin-api';

const WINDOW_LABELS: Record<ImpactWindow, string> = { week: 'Esta semana', month: 'Este mes', year: 'Este año' };

/**
 * Pedido explicito del usuario: informacion que le permita al owner
 * demostrarle a Prefiero que tan importante fue Prefi. Todo lo que se
 * muestra aqui son cifras que ya se registran para operar el sistema
 * (conversaciones, mensajes fuera de tema descartados, calificaciones) —
 * nada se inventa ni se estima sin dejarlo claro donde aplica.
 */
export default function OwnerImpactPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [windowSel, setWindowSel] = useState<ImpactWindow>('week');
  const [report, setReport] = useState<ImpactReport | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (window: ImpactWindow) => {
    try {
      const [reportData, healthData] = await Promise.all([getImpactReport(window), getSystemHealth()]);
      setReport(reportData);
      setHealth(healthData);
      setError(null);
    } catch (err) {
      if (err instanceof AdminUnauthorizedError) {
        router.push('/admin/login');
        return;
      }
      setError('No pudimos cargar el reporte de impacto.');
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
      if (role !== 'owner') {
        router.push('/admin');
        return;
      }
      setCheckingAuth(false);
      await load(windowSel);
    }
    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe correr una vez al montar; los cambios de ventana los maneja el otro efecto
  }, [router]);

  useEffect(() => {
    if (checkingAuth) return;
    load(windowSel);
  }, [windowSel, checkingAuth, load]);

  if (checkingAuth) {
    return <div className="grid h-full place-items-center text-slate-400">Verificando sesión…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="bg-gradient-to-r from-violet-700 to-fuchsia-600 bg-clip-text text-2xl font-bold text-transparent">Impacto de Prefi</h1>
          <p className="text-sm text-slate-500">Cifras para mostrarle a Prefiero el valor real del servicio.</p>
        </div>
        <Link
          href="/admin"
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-violet-200 hover:bg-violet-50"
        >
          Volver al panel
        </Link>
      </div>

      {error && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{error}</p>}

      <div className="mt-6 flex gap-2">
        {(Object.keys(WINDOW_LABELS) as ImpactWindow[]).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWindowSel(w)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              windowSel === w ? 'bg-violet-600 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:border-violet-200'
            }`}
          >
            {WINDOW_LABELS[w]}
          </button>
        ))}
      </div>

      {report && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ImpactCard label="Conversaciones atendidas" value={String(report.conversations)} />
            <ImpactCard label="Mensajes de compradores" value={String(report.customerMessages)} />
            <ImpactCard
              label="Preguntas fuera de tema descartadas"
              value={String(report.offTopicDeflected)}
              hint="Nunca gastaron una respuesta completa del agente"
            />
            <ImpactCard label="Oportunidades de catálogo detectadas" value={String(report.unmetDemandSignals)} hint="Lo que buscan y no tienes" />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">Soporte humano</h2>
              <p className="mt-3 text-3xl font-bold text-slate-900">{report.supportEscalations}</p>
              <p className="text-xs text-slate-400">conversaciones escaladas a tu equipo en este periodo</p>
              {report.averageSupportResponseSeconds !== null && (
                <p className="mt-2 text-sm text-slate-600">
                  Tiempo de respuesta promedio: <b>{formatSeconds(report.averageSupportResponseSeconds)}</b>
                </p>
              )}
            </div>
            <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">Satisfacción</h2>
              {report.ratingCount > 0 ? (
                <>
                  <p className="mt-3 text-3xl font-bold text-slate-900">{report.averageRating?.toFixed(1)} / 5</p>
                  <p className="text-xs text-slate-400">{report.ratingCount} calificaciones de compradores</p>
                </>
              ) : (
                <p className="mt-3 text-sm text-slate-400">Sin calificaciones todavía en este periodo.</p>
              )}
            </div>
          </div>
        </>
      )}

      <div className="mt-8 rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Diagnóstico del sistema</h2>
        <p className="text-xs text-slate-400">Solo lectura — para revisar el estado sin tocar nada de tu cliente.</p>
        {health ? (
          <div className="mt-3 flex flex-col gap-2">
            <HealthRow label="Base de datos" ok={health.database.ok} detail={health.database.error} />
            {health.llmProviders.map((provider) => (
              <HealthRow
                key={provider.provider}
                label={`Motor inteligente — ${provider.provider}`}
                ok={provider.configured ? provider.ok : null}
                detail={!provider.configured ? 'No configurado' : provider.message}
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">Cargando…</p>
        )}
      </div>
    </div>
  );
}

function ImpactCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean | null; detail?: string }) {
  const dotClass = ok === null ? 'bg-slate-300' : ok ? 'bg-emerald-500' : 'bg-rose-500';
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-slate-700">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden="true" />
        {label}
      </span>
      {detail && <span className="text-xs text-slate-400">{detail}</span>}
    </div>
  );
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)} min`;
}
