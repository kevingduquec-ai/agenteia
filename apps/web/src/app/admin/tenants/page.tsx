'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminUnauthorizedError,
  addTenantKnowledgeSource,
  checkAdminSession,
  createTenant,
  deleteTenantKnowledgeSource,
  listTenantKnowledgeSources,
  listTenants,
  type KnowledgeSourceKind,
  type TenantKnowledgeSource,
  type TenantRow,
} from '@/lib/admin-api';

export default function AdminTenantsPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await listTenants();
      setTenants(rows);
      setError(null);
    } catch (err) {
      if (err instanceof AdminUnauthorizedError) {
        router.push('/admin/login');
        return;
      }
      setError('No pudimos cargar los clientes.');
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const currentRole = await checkAdminSession();
      if (cancelled) return;
      if (!currentRole) {
        router.push('/admin/login');
        return;
      }
      // Solo el owner da de alta clientes nuevos (pedido explicito del usuario).
      if (currentRole !== 'owner') {
        router.push('/admin');
        return;
      }
      setCheckingAuth(false);
      await load();
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [router, load]);

  if (checkingAuth) {
    return <div className="grid h-full place-items-center text-slate-400">Verificando sesión…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="bg-gradient-to-r from-violet-700 to-fuchsia-600 bg-clip-text text-2xl font-bold text-transparent">Clientes</h1>
          <p className="text-sm text-slate-500">Da de alta un marketplace nuevo y su base de conocimiento — cada uno con su propia URL.</p>
        </div>
        <Link
          href="/admin"
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-violet-200 hover:bg-violet-50"
        >
          Volver al panel
        </Link>
      </div>

      {error && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{error}</p>}

      <CreateTenantForm onCreated={load} />

      <div className="mt-8 flex flex-col gap-4">
        {tenants.length === 0 ? (
          <p className="rounded-2xl border border-violet-100 bg-white py-6 text-center text-sm text-slate-400 shadow-sm">
            Todavía no hay clientes registrados.
          </p>
        ) : (
          tenants.map((tenant) => (
            <TenantCard
              key={tenant.id}
              tenant={tenant}
              expanded={expandedId === tenant.id}
              onToggle={() => setExpandedId((current) => (current === tenant.id ? null : tenant.id))}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CreateTenantForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [crawlerBaseUrl, setCrawlerBaseUrl] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdTenant, setCreatedTenant] = useState<TenantRow | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setIsBusy(true);
    try {
      const { tenant } = await createTenant({ slug: slug.trim(), name: name.trim(), host: host.trim(), crawlerBaseUrl: crawlerBaseUrl.trim() });
      setSlug('');
      setName('');
      setHost('');
      setCrawlerBaseUrl('');
      setCreatedTenant(tenant);
      await onCreated();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No pudimos crear el cliente.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Nuevo cliente</h2>
      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Slug (ej. acr)" value={slug} onChange={setSlug} required minLength={2} pattern="[a-z0-9]+(-[a-z0-9]+)*" />
        <Field label="Nombre" value={name} onChange={setName} required minLength={2} placeholder="Prefiero ACR+" />
        <Field label="Subdominio (host)" value={host} onChange={setHost} required minLength={3} placeholder="acr.app.tu-dominio.com" />
        <Field
          label="Sitio del cliente (crawler)"
          value={crawlerBaseUrl}
          onChange={setCrawlerBaseUrl}
          required
          type="url"
          placeholder="https://sitio-del-cliente.com"
        />
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={isBusy}
            className="rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 px-5 py-2.5 font-medium text-white shadow-md shadow-violet-300/50 transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? 'Creando…' : 'Crear cliente'}
          </button>
        </div>
      </form>
      {formError && <p className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{formError}</p>}
      {createdTenant && (
        <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">&ldquo;{createdTenant.name}&rdquo; creado.</p>
          <p className="mt-1 text-emerald-700">
            Registra sus páginas de FAQ/garantía/envíos abajo, y corre por CLI (todavía sin UI):{' '}
            <code className="rounded bg-emerald-100 px-1.5 py-0.5">
              pnpm run harvest -- --tenant={createdTenant.slug}
            </code>{' '}
            para traer su catálogo.
          </p>
        </div>
      )}
    </div>
  );
}

function TenantCard({ tenant, expanded, onToggle }: { tenant: TenantRow; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{tenant.name}</p>
          <p className="text-xs text-slate-400">
            {tenant.host} · cosecha {tenant.crawlerBaseUrl} · cupos {tenant.maxAdminSeats} admin / {tenant.maxSupportSeats} soporte
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded-full border border-violet-200 bg-white px-3.5 py-1.5 text-xs font-medium text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-50"
        >
          {expanded ? 'Ocultar fuentes de conocimiento' : 'Fuentes de conocimiento'}
        </button>
      </div>
      {expanded && <KnowledgeSourcesPanel tenant={tenant} />}
    </div>
  );
}

function KnowledgeSourcesPanel({ tenant }: { tenant: TenantRow }) {
  const [sources, setSources] = useState<TenantKnowledgeSource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<KnowledgeSourceKind>('heading');
  const [sourceUrl, setSourceUrl] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await listTenantKnowledgeSources(tenant.id);
      setSources(rows);
      setError(null);
    } catch {
      setError('No pudimos cargar las fuentes de este cliente.');
    } finally {
      setLoaded(true);
    }
  }, [tenant.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    let headers: Record<string, string> | undefined;
    if (headersText.trim()) {
      try {
        headers = JSON.parse(headersText) as Record<string, string>;
      } catch {
        setFormError('Los headers deben ser JSON válido, ej. {"Token-Client":"..."}');
        return;
      }
    }

    setIsBusy(true);
    try {
      await addTenantKnowledgeSource(tenant.id, {
        url: url.trim(),
        kind,
        sourceUrl: sourceUrl.trim() || undefined,
        headers,
      });
      setUrl('');
      setSourceUrl('');
      setHeadersText('');
      setKind('heading');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No pudimos agregar la fuente.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete(sourceId: string) {
    setIsBusy(true);
    try {
      await deleteTenantKnowledgeSource(tenant.id, sourceId);
      await load();
    } catch {
      setError('No pudimos eliminar esa fuente.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      {error && <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">{error}</p>}

      {!loaded ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : sources.length === 0 ? (
        <p className="text-sm text-slate-400">Sin páginas registradas todavía — agrega su FAQ/garantía/envíos/políticas abajo.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sources.map((source) => (
            <li key={source.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-700">{source.url}</p>
                <p className="text-xs text-slate-400">
                  {source.kind === 'frequent-questions-api' ? 'API de preguntas frecuentes' : 'Página con encabezados'}
                  {source.sourceUrl ? ` · muestra como ${source.sourceUrl}` : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => handleDelete(source.id)}
                className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-3 rounded-xl bg-slate-50 p-3.5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="URL de la página o endpoint" value={url} onChange={setUrl} required type="url" placeholder="https://sitio-del-cliente.com/preguntas-frecuentes" small />
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Tipo
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as KnowledgeSourceKind)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
            >
              <option value="heading">Página con encabezados (FAQ/políticas normales)</option>
              <option value="frequent-questions-api">API de preguntas frecuentes (JSON)</option>
            </select>
          </label>
        </div>
        {kind === 'frequent-questions-api' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="URL a mostrar (la página real que ve el visitante)"
              value={sourceUrl}
              onChange={setSourceUrl}
              type="url"
              placeholder="https://sitio-del-cliente.com/contacto"
              small
            />
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Headers extra (JSON, opcional)
              <input
                type="text"
                value={headersText}
                onChange={(event) => setHeadersText(event.target.value)}
                placeholder='{"Token-Client":"..."}'
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              />
            </label>
          </div>
        )}
        <div>
          <button
            type="submit"
            disabled={isBusy}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? 'Agregando…' : 'Agregar fuente'}
          </button>
        </div>
        {formError && <p className="text-xs font-medium text-rose-600">{formError}</p>}
      </form>
      <p className="mt-3 text-xs text-slate-400">
        Después de agregar todas las páginas, corre por CLI:{' '}
        <code className="rounded bg-slate-100 px-1.5 py-0.5">pnpm run ingest-knowledge -- --tenant={tenant.slug}</code>
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = 'text',
  minLength,
  pattern,
  placeholder,
  small,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  minLength?: number;
  pattern?: string;
  placeholder?: string;
  small?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 font-medium text-slate-700 ${small ? 'text-xs' : 'text-sm'}`}>
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        minLength={minLength}
        pattern={pattern}
        placeholder={placeholder}
        className={`rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-200 ${small ? 'text-sm' : 'text-[15px]'}`}
      />
    </label>
  );
}
