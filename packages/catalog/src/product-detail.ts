import { findProductByName, getProductAttributes, getProductById, type ProductAttributeRow } from '@prefiero-ia/database';
import { searchProducts } from './search.js';
import { toProductSummary, type ProductSummary } from './types.js';

export interface ProductDetail extends ProductSummary {
  attributes: ProductAttributeRow[];
}

/** Resuelve un producto por id (UUID) o, si no es un id valido, por el nombre mas parecido — asi el tool sirve tanto si el LLM trae el id exacto (de una busqueda previa) como si solo tiene el nombre que escribio el usuario. */
export async function resolveProduct(idOrName: string): Promise<ProductDetail | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrName);
  const row = isUuid ? await getProductById(idOrName) : await findProductByName(idOrName);
  if (!row) {
    return null;
  }
  const attributes = await getProductAttributes(row.id);
  return { ...toProductSummary(row), attributes };
}

export async function resolveProducts(idsOrNames: string[]): Promise<ProductDetail[]> {
  const results = await Promise.all(idsOrNames.map((value) => resolveProduct(value)));
  return results.filter((product): product is ProductDetail => product !== null);
}

export interface SimilarProductsInput {
  productId: string;
  limit?: number;
}

/** Mismo tipo de producto (categoria) y rango de precio parecido (±40%) al de referencia — nunca inventa un criterio de "similar" mas alla de lo que el catalogo puede filtrar. */
export async function findSimilarProducts({ productId, limit = 6 }: SimilarProductsInput): Promise<ProductSummary[]> {
  const reference = await getProductById(productId);
  if (!reference) {
    return [];
  }
  return searchProducts({
    categoryName: reference.categoryName ?? undefined,
    minPrice: reference.price * 0.6,
    maxPrice: reference.price * 1.4,
    excludeProductId: reference.id,
    limit,
  });
}

export interface CheaperAlternativesInput {
  productId: string;
  limit?: number;
}

export async function findCheaperAlternatives({ productId, limit = 6 }: CheaperAlternativesInput): Promise<ProductSummary[]> {
  const reference = await getProductById(productId);
  if (!reference) {
    return [];
  }
  return searchProducts({
    categoryName: reference.categoryName ?? undefined,
    maxPrice: reference.price,
    excludeProductId: reference.id,
    limit,
  });
}

