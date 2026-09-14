import { getProductBySlug } from '@prefiero-ia/database';
import { toProductSummary, type ProductSummary } from './types.js';

/**
 * Contexto de la pagina del sitio real desde donde se abrio el chat
 * (sección 33-34) — lo manda el widget embebido (`embed.js`) con la ruta
 * de la pagina host, nunca con datos de nuestra DB (el host no los tiene).
 */
export interface PageContext {
  path?: string;
}

const PRODUCT_PATH_PATTERN = /^\/p\/([^/?#]+)/;

/** Si la ruta es una ficha de producto (`/p/<slug>`), resuelve el producto real correspondiente — null si la ruta no es de producto o el slug no existe (pudo haber sido descontinuado). */
export async function resolveProductFromPageContext(context: PageContext | null | undefined): Promise<ProductSummary | null> {
  const path = context?.path;
  if (!path) {
    return null;
  }
  const match = PRODUCT_PATH_PATTERN.exec(path);
  if (!match) {
    return null;
  }
  const row = await getProductBySlug(match[1]);
  return row ? toProductSummary(row) : null;
}
