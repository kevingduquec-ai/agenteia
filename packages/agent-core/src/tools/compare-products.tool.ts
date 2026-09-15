import { resolveProduct, type ProductDetail } from '@prefiero-ia/catalog';
import type { ToolDefinition } from '@prefiero-ia/llm';
import type { ToolHandler } from '../tool-registry.js';

export const COMPARE_PRODUCTS_TOOL_NAME = 'compare_products';

export const compareProductsToolDefinition: ToolDefinition = {
  name: COMPARE_PRODUCTS_TOOL_NAME,
  description: 'Trae el detalle de dos o mas productos especificos por nombre, para compararlos.',
  parameters: {
    type: 'object',
    properties: {
      productNames: {
        type: 'array',
        items: { type: 'string' },
        description: 'Nombres o descripciones de los productos a comparar (minimo dos).',
      },
    },
    required: ['productNames'],
  },
};

export interface CompareProductsArgs {
  productNames: string[];
}

export interface CompareProductsResult {
  found: ProductDetail[];
  notFound: string[];
}

export const compareProductsHandler: ToolHandler<CompareProductsArgs, CompareProductsResult> = async (args, ctx) => {
  const names = args.productNames ?? [];
  const results = await Promise.all(names.map(async (name) => ({ name, product: await resolveProduct(ctx.tenantId, name) })));
  return {
    found: results.filter((r): r is { name: string; product: ProductDetail } => r.product !== null).map((r) => r.product),
    notFound: results.filter((r) => r.product === null).map((r) => r.name),
  };
};
