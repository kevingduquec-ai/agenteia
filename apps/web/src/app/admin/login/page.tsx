'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminLogin } from '@/lib/admin-api';

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      const result = await adminLogin(username, password);
      if (result.ok) {
        router.push(result.role === 'soporte' ? '/admin/support' : '/admin');
      } else {
        setError(result.message || 'Usuario o contraseña incorrectos.');
      }
    } catch {
      setError('No pudimos conectar con el servidor. Intenta de nuevo.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-3xl border border-violet-100 bg-white p-8 shadow-lg">
        <h1 className="bg-gradient-to-r from-violet-700 to-fuchsia-600 bg-clip-text text-center text-2xl font-bold text-transparent">
          Panel admin
        </h1>
        <p className="mt-1 text-center text-sm text-slate-500">Prefi</p>

        <div className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Usuario
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[15px] outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[15px] outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-200"
            />
          </label>
        </div>

        {error && <p className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">{error}</p>}

        <button
          type="submit"
          disabled={isBusy}
          className="mt-6 w-full rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 py-2.5 font-medium text-white shadow-md shadow-violet-300/50 transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isBusy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
