import { insertUnmetDemand } from '@prefiero-ia/database';
import type { ToolDefinition } from '@prefiero-ia/llm';
import type { ToolHandler } from '../tool-registry.js';

export const REGISTER_UNMET_DEMAND_TOOL_NAME = 'register_unmet_demand';

export const registerUnmetDemandToolDefinition: ToolDefinition = {
  name: REGISTER_UNMET_DEMAND_TOOL_NAME,
  description:
    'Registra que el usuario busco un producto que todavia no se puede resolver por catalogo, extrayendo del mensaje la categoria, marca y presupuesto/cuota si se mencionan. Usar SIEMPRE que la intencion sea sobre productos del catalogo que aun no esta disponible.',
  parameters: {
    type: 'object',
    properties: {
      requestedCategory: {
        type: 'string',
        description: 'Categoria o tipo de producto que el usuario busca (ej. "tenis", "celular"). Omitir si no se menciona.',
      },
      requestedBrand: {
        type: 'string',
        description: 'Marca mencionada por el usuario. Omitir si no se menciona.',
      },
      budget: {
        type: 'number',
        description: 'Presupuesto total o valor de cuota mencionado, en pesos colombianos (COP). Omitir si no se menciona.',
      },
    },
    required: [],
  },
};

export interface RegisterUnmetDemandArgs {
  requestedCategory?: string | null;
  requestedBrand?: string | null;
  budget?: number | null;
}

export interface RegisterUnmetDemandContext {
  query: string;
  normalizedIntent: string;
  conversationId?: string | null;
}

/** El contexto (mensaje original, intencion, conversacion) lo fija el Agent Engine — el LLM solo aporta los datos que pudo extraer. */
export function createRegisterUnmetDemandHandler(context: RegisterUnmetDemandContext): ToolHandler<RegisterUnmetDemandArgs, { registered: true }> {
  return async (args) => {
    await insertUnmetDemand({
      query: context.query,
      normalizedIntent: context.normalizedIntent,
      conversationId: context.conversationId,
      requestedCategory: args.requestedCategory?.trim() || null,
      requestedBrand: args.requestedBrand?.trim() || null,
      budget: args.budget ?? null,
    });
    return { registered: true };
  };
}
