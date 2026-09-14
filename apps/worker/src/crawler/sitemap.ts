import * as cheerio from 'cheerio';
import { politeFetch } from './http.js';

/**
 * El sitemap.xml de Prefiero ACR+ incluye tanto categorias como los ~1.782
 * productos publicados (bajo /p/<slug>) en una sola lista plana — no hace
 * falta paginar el listado /productos (que es client-side y no expone todo
 * el catalogo via HTTP plano).
 */
export async function discoverProductUrls(baseUrl: string, delayMs: number): Promise<string[]> {
  const xml = await politeFetch(new URL('/sitemap.xml', baseUrl).toString(), delayMs);
  const $ = cheerio.load(xml, { xmlMode: true });

  const urls: string[] = [];
  $('url > loc').each((_, el) => {
    const loc = $(el).text().trim();
    if (new URL(loc).pathname.startsWith('/p/')) {
      urls.push(loc);
    }
  });

  return urls;
}
