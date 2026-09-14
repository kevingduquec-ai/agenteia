import type { Metadata } from 'next';

// El layout raiz es de altura fija (`overflow-hidden`, pensado para el
// chat, que nunca hace scroll de pagina). El panel admin si necesita
// scroll normal (tablas largas), asi que este layout lo habilita de nuevo
// solo para /admin.
export const metadata: Metadata = {
  title: 'Panel admin — Prefi',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-full w-full overflow-y-auto bg-slate-50">{children}</div>;
}
