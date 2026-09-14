import { closePool, markStaleProductsInactive, upsertBrand, upsertCategoryPath, upsertProduct, upsertSeller } from '@prefiero-ia/database';
import { parseProductDetailPage } from './detail-parser.js';
import { contentHash } from './hash.js';
import { politeFetch } from './http.js';
import { discoverProductUrls } from './sitemap.js';

export interface HarvestOptions {
  baseUrl: string;
  delayMs: number;
  limit?: number;
}

export interface HarvestSummary {
  discovered: number;
  processed: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  deactivated: number;
  errors: Array<{ url: string; message: string }>;
}

export async function runHarvest(options: HarvestOptions, onProgress?: (done: number, total: number) => void): Promise<HarvestSummary> {
  const { baseUrl, delayMs } = options;
  const summary: HarvestSummary = {
    discovered: 0,
    processed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    deactivated: 0,
    errors: [],
  };

  // Se marca ANTES de arrancar: cualquier producto tocado en esta corrida
  // (nuevo o existente) va a quedar con `last_seen_at` >= este momento.
  const startedAt = new Date();

  const allUrls = await discoverProductUrls(baseUrl, delayMs);
  summary.discovered = allUrls.length;
  const urls = options.limit ? allUrls.slice(0, options.limit) : allUrls;

  for (const [index, url] of urls.entries()) {
    try {
      const html = await politeFetch(url, delayMs);
      const detail = parseProductDetailPage(html, url);
      if (!detail) {
        summary.failed += 1;
        summary.errors.push({ url, message: 'No se encontro JSON-LD de tipo Product en la pagina.' });
        continue;
      }

      const slug = new URL(url).pathname.replace(/^\/p\//, '');
      const externalId = detail.sku || slug;

      const brandId = detail.brandName ? await upsertBrand(detail.brandName) : null;
      const categoryId = await upsertCategoryPath(detail.categoryPath);
      const sellerId = detail.sellerName ? await upsertSeller(detail.sellerName, detail.sellerSlug ?? '') : null;

      const hash = contentHash([
        detail.name,
        detail.price,
        detail.originalPrice,
        detail.installmentValue,
        detail.installmentCount,
        detail.description,
        detail.images[0],
      ]);

      const result = await upsertProduct({
        externalId,
        name: detail.name,
        slug,
        description: detail.description,
        url,
        imageUrl: detail.images[0] ?? null,
        brandId,
        categoryId,
        sellerId,
        price: detail.price,
        originalPrice: detail.originalPrice,
        discountPercentage: detail.discountPercentage,
        installmentValue: detail.installmentValue,
        installmentCount: detail.installmentCount,
        currency: detail.currency,
        contentHash: hash,
      });

      summary.processed += 1;
      summary[result.status] += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({ url, message: error instanceof Error ? error.message : String(error) });
    }

    onProgress?.(index + 1, urls.length);
  }

  // Solo en una cosecha SIN limite: cualquier producto no tocado en esta
  // corrida ya no aparece en el sitio real (sitemap.xml se recorrio
  // completo) — probablemente descontinuado. Con `--limit` la mayoria del
  // catalogo queda fuera a proposito, marcarlo aqui seria un falso masivo.
  if (!options.limit) {
    summary.deactivated = await markStaleProductsInactive(startedAt);
  }

  await closePool();
  return summary;
}
