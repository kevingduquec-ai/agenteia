'use client';

import { useState } from 'react';

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Pedido explicito del usuario: que el comprador pueda calificar la
 * atencion al terminar el chat. Se muestra justo antes de reiniciar la
 * conversacion (ver `ChatPanel`) — el unico momento en que "la atencion
 * terminó" es un hecho claro, en vez de interrumpir a mitad de una
 * conversacion todavia activa.
 */
export function RatingPrompt({ onSubmit, onSkip }: { onSubmit: (rating: number, comment?: string) => void; onSkip: () => void }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [comment, setComment] = useState('');

  const shown = hovered ?? selected ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-violet-100 bg-white p-6 text-center shadow-lg">
      <div>
        <p className="text-base font-semibold text-slate-800">¿Cómo calificarías esta atención?</p>
        <p className="mt-1 text-sm text-slate-500">Tu opinión nos ayuda a mejorar.</p>
      </div>

      <div className="flex gap-1.5" role="radiogroup" aria-label="Calificación de 1 a 5 estrellas">
        {STARS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected === value}
            aria-label={`${value} de 5 estrellas`}
            onMouseEnter={() => setHovered(value)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => setSelected(value)}
            className="p-0.5 transition-transform duration-100 hover:scale-110"
          >
            <StarIcon filled={value <= shown} />
          </button>
        ))}
      </div>

      {selected !== null && (
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="¿Algo que quieras contarnos? (opcional)"
          rows={2}
          maxLength={500}
          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-200"
        />
      )}

      <div className="flex w-full gap-2">
        <button
          type="button"
          onClick={onSkip}
          className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50"
        >
          Omitir
        </button>
        <button
          type="button"
          disabled={selected === null}
          onClick={() => selected !== null && onSubmit(selected, comment.trim() || undefined)}
          className="flex-1 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-violet-300/50 transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill={filled ? '#a855f7' : 'none'} stroke={filled ? '#a855f7' : '#cbd5e1'} strokeWidth="1.5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2.75l2.938 6.031 6.562.984-4.75 4.688 1.125 6.578L12 17.938l-5.875 3.093 1.125-6.578-4.75-4.688 6.562-.984L12 2.75z"
      />
    </svg>
  );
}
