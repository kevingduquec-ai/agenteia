import { searchProducts, type ProductSummary } from '@prefiero-ia/catalog';
import type { ToolDefinition } from '@prefiero-ia/llm';
import type { ToolHandler } from '../tool-registry.js';

export const SEARCH_PRODUCTS_TOOL_NAME = 'search_products';

export const searchProductsToolDefinition: ToolDefinition = {
  name: SEARCH_PRODUCTS_TOOL_NAME,
  description: 'Busca productos del catalogo por texto libre, con filtros opcionales de categoria, marca y precio maximo.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Palabras clave de lo que el usuario busca (ej. "tenis running", "audifonos bluetooth").' },
      categoryName: { type: 'string', description: 'Categoria mencionada, si el usuario la nombra. Omitir si no.' },
      brandName: { type: 'string', description: 'Marca mencionada, si el usuario la nombra. Omitir si no.' },
      maxPrice: { type: 'number', description: 'Precio maximo en COP, si el usuario lo menciona. Omitir si no.' },
    },
    required: ['query'],
  },
};

export interface SearchProductsArgs {
  query: string;
  categoryName?: string;
  brandName?: string;
  maxPrice?: number;
}

export interface CatalogToolResult {
  count: number;
  products: ProductSummary[];
  note?: string;
  /** Solo lo usan similar/cheaper-alternative: confirma cual producto de referencia se encontro, para que el LLM no asuma que no existe solo porque no aparece en `products` (a proposito se excluye de su propia lista de similares/mas baratos). */
  referenceProduct?: ProductSummary;
}

export const searchProductsHandler: ToolHandler<SearchProductsArgs, CatalogToolResult> = async (args) => {
  const products = await searchProducts({
    text: args.query,
    categoryName: args.categoryName,
    brandName: args.brandName,
    maxPrice: args.maxPrice,
    limit: 8,
  });
  return { count: products.length, products };
};
