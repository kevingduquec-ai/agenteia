import { closePool, listCategorySlugs, updateInstallmentBySku } from '@prefiero-ia/database';
import { parseListingPage } from './listing-parser.js';
import { politeFetch } from './http.js';

export interface BackfillInstallmentsOptions {
  baseUrl: string;
  delayMs: number;
  limit?: number;
}

export interface BackfillInstallmentsSummary {
  categoriesVisited: number;
  categoriesFailed: number;
  cardsSeen: number;
  productsUpdated: number;
  errors: Array<{ url: string; message: string }>;
}

/**
 * Segunda pasada del crawler (ver README.md, "Limitación conocida"): la
 * cuota ACR no viaja en la ficha de producto individual (se calcula
 * client-side ahi), pero SI viaja ya calculada en las tarjetas de las
 * paginas de listado por categoria. Se recorren los slugs de categoria ya
 * conocidos (de la cosecha normal de productos) en vez de intentar
 * descubrir un listado paginado del catalogo completo — mas simple y
 * suficiente: cada categoria real del sitio es una URL valida
 * (`<baseUrl>/<slug>`) que trae sus productos en la carga inicial.
 *
 * Actualiza SOLO installment_value/installment_count por SKU — nunca toca
 * nombre/precio/categoria, que ya mantiene al dia `runHarvest`.
 */
export async function runInstallmentsBackfill(
  options: BackfillInstallmentsOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<BackfillInstallmentsSummary> {
  const { baseUrl, delayMs } = options;
  const summary: BackfillInstallmentsSummary = {
    categoriesVisited: 0,
    categoriesFailed: 0,
    cardsSeen: 0,
    productsUpdated: 0,
    errors: [],
  };

  const allSlugs = await listCategorySlugs();
  const slugs = options.limit ? allSlugs.slice(0, options.limit) : allSlugs;

  for (const [index, slug] of slugs.entries()) {
    const url = new URL(`/${slug}`, baseUrl).toString();
    try {
      const html = await politeFetch(url, delayMs);
      const cards = parseListingPage(html);
      summary.cardsSeen += cards.length;
      summary.categoriesVisited += 1;

      for (const card of cards) {
        const updated = await updateInstallmentBySku(card.sku, card.installmentValue, card.installmentCount);
        if (updated) summary.productsUpdated += 1;
      }
    } catch (error) {
      summary.categoriesFailed += 1;
      summary.errors.push({ url, message: error instanceof Error ? error.message : String(error) });
    }

    onProgress?.(index + 1, slugs.length);
  }

  await closePool();
  return summary;
}
