'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  AdminUnauthorizedError,
  checkAdminSession,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  type AdminUsersOverview,
  type ManagedAdminRole,
} from '@/lib/admin-api';

export default function AdminUsersPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [data, setData] = useState<AdminUsersOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<ManagedAdminRole>('soporte');
  const [isBusy, setIsBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDoneId, setResetDoneId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const overview = await listAdminUsers();
      setData(overview);
      setError(null);
    } catch (err) {
      if (err instanceof AdminUnauthorizedError) {
        router.push('/admin/login');
        return;
      }
      setError('No pudimos cargar los usuarios.');
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
      // Solo el owner puede gestionar cuentas (pedido explicito del usuario).
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

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setIsBusy(true);
    try {
      await createAdminUser(username.trim(), password, role);
      setUsername('');
      setPassword('');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No pudimos crear la cuenta.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setIsBusy(true);
    try {
      await deleteAdminUser(id);
      await load();
    } catch {
      setError('No pudimos eliminar la cuenta.');
    } finally {
      setIsBusy(false);
    }
  }

  function openReset(id: string) {
    setResettingId(id);
    setNewPassword('');
    setResetError(null);
  }

  async function handleResetPassword(event: React.FormEvent, id: string) {
    event.preventDefault();
    setResetError(null);
    setIsBusy(true);
    try {
      await resetAdminUserPassword(id, newPassword);
      setResettingId(null);
      setNewPassword('');
      setResetDoneId(id);
      setTimeout(() => setResetDoneId((current) => (current === id ? null : current)), 3000);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'No pudimos cambiar la contraseña.');
    } finally {
      setIsBusy(false);
    }
  }

  if (checkingAuth) {
    return <div className="grid h-full place-items-center text-slate-400">Verificando sesión…</div>;
  }

  const adminSeats = data?.seats.admin;
  const supportSeats = data?.seats.soporte;
  const roleAtLimit = role === 'admin' ? (adminSeats ? adminSeats.used >= adminSeats.limit : false) : supportSeats ? supportSeats.used >= supportSeats.limit : false;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="bg-gradient-to-r from-violet-700 to-fuchsia-600 bg-clip-text text-2xl font-bold text-transparent">Usuarios</h1>
          <p className="text-sm text-slate-500">Crea y administra las cuentas de administrador y soporte de tu plan.</p>
        </div>
        <Link
          href="/admin"
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-violet-200 hover:bg-violet-50"
        >
          Volver al panel
        </Link>
      </div>

      {error && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{error}</p>}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SeatCard label="Administradores" seats={adminSeats} />
        <SeatCard label="Soporte" seats={supportSeats} />
      </div>

      <div className="mt-8 rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Crear cuenta</h2>
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
            Usuario
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              minLength={3}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[15px] outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-200"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={10}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[15px] outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Rol
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as ManagedAdminRole)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[15px] outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-200"
            >
              <option value="soporte">Soporte</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={isBusy || roleAtLimit}
            className="rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 px-5 py-2.5 font-medium text-white shadow-md shadow-violet-300/50 transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? 'Creando…' : 'Crear'}
          </button>
        </form>
        {roleAtLimit && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            Ya usas todos los cupos de {role === 'admin' ? 'administrador' : 'soporte'} incluidos en tu plan. Contacta a ventas para ampliar.
          </p>
        )}
        {formError && <p className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{formError}</p>}
      </div>

      <div className="mt-8 rounded-2xl border border-violet-100 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Cuentas activas</h2>
        {!data || data.users.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">Todavía no has creado cuentas de administrador o soporte.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {data.users.map((user) => (
              <li key={user.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{user.username}</p>
                    <p className="text-xs text-slate-400">
                      {user.role === 'admin' ? 'Administrador' : 'Soporte'} · creada el {new Date(user.createdAt).toLocaleDateString('es-CO')}
                      {resetDoneId === user.id && <span className="ml-2 font-medium text-emerald-600">Contraseña actualizada</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => (resettingId === user.id ? setResettingId(null) : openReset(user.id))}
                      className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Cambiar contraseña
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDelete(user.id)}
                      className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
                {resettingId === user.id && (
                  <form onSubmit={(event) => handleResetPassword(event, user.id)} className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
                    <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
                      Nueva contraseña para {user.username}
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        required
                        minLength={10}
                        autoFocus
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={isBusy}
                      className="rounded-lg bg-violet-600 px-3.5 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={() => setResettingId(null)}
                      className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                    {resetError && <p className="w-full text-xs font-medium text-rose-600">{resetError}</p>}
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SeatCard({ label, seats }: { label: string; seats?: { used: number; limit: number } }) {
  const atLimit = seats ? seats.used >= seats.limit : false;
  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">
        {seats ? `${seats.used}/${seats.limit}` : '—'}
      </p>
      {atLimit && <p className="mt-1 text-xs font-medium text-amber-600">Cupos agotados — amplía tu plan</p>}
    </div>
  );
}
