import { searchProducts } from '@prefiero-ia/catalog';
import type { ToolDefinition } from '@prefiero-ia/llm';
import type { ToolHandler } from '../tool-registry.js';
import type { CatalogToolResult } from './search-products.tool.js';

export const FIND_PRODUCTS_BY_BUDGET_TOOL_NAME = 'find_products_by_budget';

export const findProductsByBudgetToolDefinition: ToolDefinition = {
  name: FIND_PRODUCTS_BY_BUDGET_TOOL_NAME,
  description: 'Busca productos del catalogo que no superen un presupuesto total en COP, con texto/categoria opcionales.',
  parameters: {
    type: 'object',
    properties: {
      budget: { type: 'number', description: 'Presupuesto total maximo en COP.' },
      query: { type: 'string', description: 'Que tipo de producto busca, si lo menciona. Omitir si no.' },
      categoryName: { type: 'string', description: 'Categoria mencionada, si aplica. Omitir si no.' },
    },
    required: ['budget'],
  },
};

export interface FindProductsByBudgetArgs {
  budget: number;
  query?: string;
  categoryName?: string;
}

export const findProductsByBudgetHandler: ToolHandler<FindProductsByBudgetArgs, CatalogToolResult> = async (args) => {
  const products = await searchProducts({
    text: args.query,
    categoryName: args.categoryName,
    maxPrice: args.budget,
    limit: 8,
  });
  return { count: products.length, products };
};
