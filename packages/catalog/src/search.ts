import { searchProducts as searchProductsInDb, type ProductSearchFilters } from '@prefiero-ia/database';
import { toProductSummary, type ProductSummary } from './types.js';

export type { ProductSearchFilters };

export async function searchProducts(tenantId: string, filters: ProductSearchFilters): Promise<ProductSummary[]> {
  const rows = await searchProductsInDb(tenantId, filters);
  return rows.map(toProductSummary);
}
