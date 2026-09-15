import { findSimilarProducts, resolveProduct } from '@prefiero-ia/catalog';
import type { ToolDefinition } from '@prefiero-ia/llm';
import type { ToolHandler } from '../tool-registry.js';
import type { CatalogToolResult } from './search-products.tool.js';

export const FIND_SIMILAR_PRODUCTS_TOOL_NAME = 'find_similar_products';

export const findSimilarProductsToolDefinition: ToolDefinition = {
  name: FIND_SIMILAR_PRODUCTS_TOOL_NAME,
  description: 'Busca productos parecidos (misma categoria, precio similar) a uno que el usuario ya menciono por nombre.',
  parameters: {
    type: 'object',
    properties: {
      productName: { type: 'string', description: 'Nombre del producto de referencia.' },
    },
    required: ['productName'],
  },
};

export interface FindSimilarProductsArgs {
  productName: string;
}

export const findSimilarProductsHandler: ToolHandler<FindSimilarProductsArgs, CatalogToolResult> = async (args, ctx) => {
  const reference = await resolveProduct(ctx.tenantId, args.productName);
  if (!reference) {
    return { count: 0, products: [], note: `No encontre "${args.productName}" en el catalogo.` };
  }
  const products = await findSimilarProducts(ctx.tenantId, { productId: reference.id });
  return { count: products.length, products, referenceProduct: reference };
};
