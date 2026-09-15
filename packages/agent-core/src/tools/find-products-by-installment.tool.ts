import { searchProducts } from '@prefiero-ia/catalog';
import type { ToolDefinition } from '@prefiero-ia/llm';
import type { ToolHandler } from '../tool-registry.js';
import type { CatalogToolResult } from './search-products.tool.js';

export const FIND_PRODUCTS_BY_INSTALLMENT_TOOL_NAME = 'find_products_by_installment';

export const findProductsByInstallmentToolDefinition: ToolDefinition = {
  name: FIND_PRODUCTS_BY_INSTALLMENT_TOOL_NAME,
  description: 'Busca productos del catalogo cuya cuota mensual de Credito ACR no supere un valor en COP.',
  parameters: {
    type: 'object',
    properties: {
      maxInstallment: { type: 'number', description: 'Valor maximo de cuota mensual en COP que el usuario puede pagar.' },
      query: { type: 'string', description: 'Que tipo de producto busca, si lo menciona. Omitir si no.' },
      categoryName: { type: 'string', description: 'Categoria mencionada, si aplica. Omitir si no.' },
    },
    required: ['maxInstallment'],
  },
};

export interface FindProductsByInstallmentArgs {
  maxInstallment: number;
  query?: string;
  categoryName?: string;
}

/**
 * El valor de cuota mensual (`installment_value`) se completa via
 * `apps/worker/src/crawler/backfill-installments.ts` — ACR lo calcula del
 * lado del cliente y no viaja en el payload de la ficha de producto
 * individual, asi que se lee de las tarjetas de las paginas de listado por
 * categoria (ver `docs/FIXES-2026-09-14.md`). La cobertura no es 100%: un
 * producto cuyo SKU nunca aparecio en ninguna pagina de categoria visitada
 * se queda sin cuota. Por eso, ante cero resultados, la nota es honesta
 * sobre esa posibilidad en vez de afirmar tajantemente "no existe nada".
 */
export const findProductsByInstallmentHandler: ToolHandler<FindProductsByInstallmentArgs, CatalogToolResult> = async (args, ctx) => {
  const products = await searchProducts(ctx.tenantId, {
    text: args.query,
    categoryName: args.categoryName,
    maxInstallment: args.maxInstallment,
    limit: 8,
  });

  if (products.length === 0) {
    return {
      count: 0,
      products: [],
      note: 'No encontré productos con esa cuota o menos en el catálogo. La cuota mensual todavía no está registrada para el 100% de los productos, así que podría existir una opción que no aparece aquí.',
    };
  }

  return { count: products.length, products };
};
