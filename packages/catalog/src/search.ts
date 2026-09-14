import { searchProducts as searchProductsInDb, type ProductSearchFilters } from '@prefiero-ia/database';
import { toProductSummary, type ProductSummary } from './types.js';

export type { ProductSearchFilters };

export async function searchProducts(filters: ProductSearchFilters): Promise<ProductSummary[]> {
  const rows = await searchProductsInDb(filters);
  return rows.map(toProductSummary);
}
