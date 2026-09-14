export interface QuickAction {
  emoji: string;
  label: string;
  prompt: string;
  /**
   * "Problemas con tu compra o tu pedido" pedido explicito del usuario:
   * a diferencia de las demas acciones (que pasan por el clasificador de
   * intencion, con margen de error), esta debe caer SIEMPRE en soporte
   * humano — el comprador ya viene frustrado y no puede arriesgarse a que
   * el sistema la interprete como otra cosa.
   */
  forceHumanSupport?: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { emoji: '🔎', label: 'Buscar un producto', prompt: 'Quiero buscar un producto, ¿me ayudas?' },
  { emoji: '💳', label: 'Comprar por cuota', prompt: 'Quiero comprar algo pagando por cuotas, ¿cómo funciona?' },
  { emoji: '💰', label: 'Comprar por presupuesto', prompt: 'Tengo un presupuesto definido, ¿qué me recomiendas?' },
  { emoji: '🎁', label: 'Buscar un regalo', prompt: 'Necesito ayuda para elegir un regalo.' },
  { emoji: '❓', label: 'Resolver una duda', prompt: '¿Cómo funciona Prefiero ACR+?' },
  {
    emoji: '📦',
    label: 'Problemas con tu compra o tu pedido',
    prompt: 'Tengo un problema con mi compra o mi pedido y necesito hablar con un agente de soporte.',
    forceHumanSupport: true,
  },
];

export function QuickActions({
  onSelect,
  disabled,
}: {
  onSelect: (prompt: string, forceHumanSupport?: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2 px-4">
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(action.prompt, action.forceHumanSupport)}
          className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-4 py-2.5 text-sm font-medium text-violet-700 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-transparent hover:bg-gradient-to-br hover:from-violet-600 hover:to-fuchsia-500 hover:text-white hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-violet-200 disabled:hover:bg-white disabled:hover:text-violet-700"
        >
          <span aria-hidden="true">{action.emoji}</span>
          {action.label}
        </button>
      ))}
    </div>
  );
}
