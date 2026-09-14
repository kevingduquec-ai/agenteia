import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ProductSummary } from '@/lib/api';

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'support_agent';
  content: string;
  pending?: boolean;
  products?: ProductSummary[];
}

// El LLM responde en Markdown (negritas, listas) — sin esto se veian los
// asteriscos/guiones crudos en vez de texto formateado.
const MARKDOWN_COMPONENTS = {
  p: (props: React.ComponentPropsWithoutRef<'p'>) => <p className="mb-2 last:mb-0" {...props} />,
  strong: (props: React.ComponentPropsWithoutRef<'strong'>) => <strong className="font-semibold text-slate-900" {...props} />,
  ul: (props: React.ComponentPropsWithoutRef<'ul'>) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0" {...props} />,
  ol: (props: React.ComponentPropsWithoutRef<'ol'>) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0" {...props} />,
  li: (props: React.ComponentPropsWithoutRef<'li'>) => <li className="pl-1 marker:text-violet-400" {...props} />,
  a: (props: React.ComponentPropsWithoutRef<'a'>) => (
    <a className="font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-800" target="_blank" rel="noopener noreferrer" {...props} />
  ),
};

export function MessageBubble({ message }: { message: DisplayMessage }) {
  const isUser = message.role === 'user';
  const isSupportAgent = message.role === 'support_agent';

  return (
    <div className={`flex w-full flex-col ${isUser ? 'items-end' : 'items-start'} gap-1`}>
      {isSupportAgent && <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Agente de soporte</p>}
      <div
        className={`max-w-[85%] rounded-3xl px-5 py-3.5 text-[15px] leading-relaxed shadow-sm sm:max-w-[75%] ${
          isUser
            ? 'whitespace-pre-wrap rounded-br-lg bg-gradient-to-br from-violet-600 to-violet-500 text-white'
            : isSupportAgent
              ? 'whitespace-pre-wrap rounded-bl-lg border border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'rounded-bl-lg border border-violet-100 bg-white text-slate-800'
        }`}
      >
        {message.content ? (
          isUser || isSupportAgent ? (
            message.content
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {message.content}
            </ReactMarkdown>
          )
        ) : message.pending ? (
          <TypingDots />
        ) : null}
        {!isUser && message.pending && message.content && <BlinkingCursor />}
      </div>
      {!isUser && message.products && message.products.length > 0 && <ProductCardRow products={message.products} />}
    </div>
  );
}

function ProductCardRow({ products }: { products: ProductSummary[] }) {
  return (
    <div className="flex w-full max-w-[95%] gap-3 overflow-x-auto pb-2 sm:max-w-[85%]">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

function ProductCard({ product }: { product: ProductSummary }) {
  const hasDiscount = product.originalPrice !== null && product.originalPrice > product.price;

  return (
    <a
      href={product.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group flex w-40 shrink-0 flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-lg ${
        product.isActive ? 'border-violet-100 hover:border-violet-300' : 'border-slate-200 opacity-70'
      }`}
    >
      <div className="relative flex h-28 w-full items-center justify-center bg-slate-50">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagenes externas del marketplace, no vale la pena configurar next/image para un dominio ajeno
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-full w-full object-contain transition duration-150 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <span className="text-xs text-slate-400">Sin imagen</span>
        )}
        {hasDiscount && product.isActive && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
            -{product.discountPercentage ?? Math.round((1 - product.price / product.originalPrice!) * 100)}%
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <p className="line-clamp-2 text-xs font-medium leading-snug text-slate-800">{product.name}</p>
        {!product.isActive ? (
          <p className="text-xs font-semibold text-slate-400">Ya no disponible</p>
        ) : (
          <>
            <p className="text-sm font-bold text-violet-700">{formatCOP(product.price)}</p>
            {hasDiscount && <p className="text-xs text-slate-400 line-through">{formatCOP(product.originalPrice!)}</p>}
          </>
        )}
      </div>
    </a>
  );
}

function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount);
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1" aria-label="Prefi está escribiendo">
      <span className="h-2 w-2 animate-bounce rounded-full bg-violet-300 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-violet-300 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-violet-300" />
    </span>
  );
}

function BlinkingCursor() {
  return <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-violet-400 align-text-bottom" />;
}
