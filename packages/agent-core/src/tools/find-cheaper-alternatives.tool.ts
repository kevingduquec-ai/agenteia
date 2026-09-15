import { findCheaperAlternatives, resolveProduct } from '@prefiero-ia/catalog';
import type { ToolDefinition } from '@prefiero-ia/llm';
import type { ToolHandler } from '../tool-registry.js';
import type { CatalogToolResult } from './search-products.tool.js';

export const FIND_CHEAPER_ALTERNATIVES_TOOL_NAME = 'find_cheaper_alternatives';

export const findCheaperAlternativesToolDefinition: ToolDefinition = {
  name: FIND_CHEAPER_ALTERNATIVES_TOOL_NAME,
  description: 'Busca opciones mas economicas (misma categoria, precio menor o igual) a un producto que el usuario ya menciono por nombre.',
  parameters: {
    type: 'object',
    properties: {
      productName: { type: 'string', description: 'Nombre del producto de referencia.' },
    },
    required: ['productName'],
  },
};

export interface FindCheaperAlternativesArgs {
  productName: string;
}

export const findCheaperAlternativesHandler: ToolHandler<FindCheaperAlternativesArgs, CatalogToolResult> = async (args, ctx) => {
  const reference = await resolveProduct(ctx.tenantId, args.productName);
  if (!reference) {
    return { count: 0, products: [], note: `No encontre "${args.productName}" en el catalogo.` };
  }
  const products = await findCheaperAlternatives(ctx.tenantId, { productId: reference.id });
  if (products.length === 0) {
    return {
      count: 0,
      products: [],
      referenceProduct: reference,
      note: `"${reference.name}" ya parece ser de las opciones mas economicas en su categoria.`,
    };
  }
  return { count: products.length, products, referenceProduct: reference };
};
