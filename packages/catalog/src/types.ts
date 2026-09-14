import type { ProductRow } from '@prefiero-ia/database';

/** Resumen de producto tal como lo ve el LLM/el usuario — nunca la fila cruda de la DB, para no filtrar columnas internas (content_hash, ids de FK, etc.). */
export interface ProductSummary {
  id: string;
  name: string;
  url: string;
  imageUrl: string | null;
  price: number;
  originalPrice: number | null;
  discountPercentage: number | null;
  installmentValue: number | null;
  installmentCount: number | null;
  currency: string;
  isOffer: boolean;
  /** false = el harvester ya no lo ve en el sitio (descontinuado). `searchProducts` nunca devuelve estos; solo aparece al resolver un producto puntual por id/nombre, para poder avisar que ya no esta disponible. */
  isActive: boolean;
  categoryName: string | null;
  brandName: string | null;
  sellerName: string | null;
}

export function toProductSummary(row: ProductRow): ProductSummary {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    imageUrl: row.imageUrl,
    price: row.price,
    originalPrice: row.originalPrice,
    discountPercentage: row.discountPercentage,
    installmentValue: row.installmentValue,
    installmentCount: row.installmentCount,
    currency: row.currency,
    isOffer: row.isOffer,
    isActive: row.isActive,
    categoryName: row.categoryName,
    brandName: row.brandName,
    sellerName: row.sellerName,
  };
}

export function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount);
}
