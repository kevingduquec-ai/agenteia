import type { Metadata } from 'next';
import { ChatPanel } from '@/components/ChatPanel';

// Esta pagina esta pensada para vivir dentro de un <iframe> pequeño
// (ver public/embed.js) — no debe indexarse ni promocionarse como pagina
// propia del sitio.
export const metadata: Metadata = {
  title: 'Prefi',
  robots: { index: false, follow: false },
};

interface WidgetPageProps {
  searchParams: Promise<{ path?: string }>;
}

// `embed.js` manda la ruta de la pagina host (ej. `/p/iphone-17`) como
// query param — se lee del lado del servidor y se pasa a ChatPanel para
// que la envie con el resto de la sesion (sección 33-34).
export default async function WidgetPage({ searchParams }: WidgetPageProps) {
  const { path } = await searchParams;
  return <ChatPanel pageContext={path ? { path } : undefined} />;
}
