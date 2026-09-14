import * as cheerio from 'cheerio';
import { extractNextFlightValues, findInFlightValues } from './next-flight.js';

export interface CategoryPathSegment {
  name: string;
  slug: string;
}

export interface ProductDetail {
  name: string;
  description: string | null;
  images: string[];
  brandName: string | null;
  price: number;
  currency: string;
  sellerName: string | null;
  sellerSlug: string | null;
  sku: string | null;
  installmentValue: number | null;
  installmentCount: number | null;
  originalPrice: number | null;
  discountPercentage: number | null;
  categoryPath: CategoryPathSegment[];
}

interface RawImage {
  url?: string;
}

interface RawCategoryPathEntry {
  slug?: string;
  name?: string;
}

interface RawProductBlob {
  slug: string;
  name: string;
  reference?: string | null;
  description?: string | null;
  price?: string | number | null;
  compare_at_price?: string | number | null;
  image?: string | null;
  images?: RawImage[];
  category_path?: RawCategoryPathEntry[];
  seller_name?: string | null;
  seller_slug?: string | null;
  item_brand?: string | null;
}

function isRawProductBlob(value: unknown, slug: string): value is RawProductBlob {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.slug === slug && typeof v.name === 'string' && 'reference' in v && 'price' in v;
}

/**
 * Extrae los datos del producto desde el objeto React-Server-Component que
 * Next.js incrusta en la pagina (ver next-flight.ts) — es la misma fuente
 * que usa el propio frontend de ACR+ para pintar la ficha, asi que trae
 * precio, categoria y vendedor ya estructurados en vez de tener que leer
 * clases CSS. La cuota ACR ("N cuotas de $X") no viaja en este objeto para
 * el producto principal (el buy-box la calcula en el cliente) y por eso
 * queda en null: no la inventamos ni la adivinamos con una formula propia.
 */
export function parseProductDetailPage(html: string, url: string): ProductDetail | null {
  const slug = new URL(url).pathname.replace(/^\/p\//, '');
  const $ = cheerio.load(html);
  const flightValues = extractNextFlightValues($);

  const blob = findInFlightValues(flightValues, (value): value is RawProductBlob => isRawProductBlob(value, slug));
  if (!blob) {
    return null;
  }

  const images = (blob.images ?? [])
    .map((img) => img.url)
    .filter((url): url is string => Boolean(url));
  if (images.length === 0 && blob.image) {
    images.push(blob.image);
  }

  const categoryPath: CategoryPathSegment[] = (blob.category_path ?? [])
    .filter((entry) => entry.slug && entry.name)
    .map((entry) => ({ slug: entry.slug as string, name: entry.name as string }));

  const price = toNumber(blob.price) ?? 0;
  const originalPrice = toNumber(blob.compare_at_price);
  const discountPercentage =
    originalPrice && originalPrice > price ? Math.round(((originalPrice - price) / originalPrice) * 100) : null;

  return {
    name: blob.name,
    description: blob.description ? stripHtml(blob.description) : null,
    images,
    brandName: blob.item_brand ?? null,
    price,
    currency: 'COP',
    sellerName: blob.seller_name ?? null,
    sellerSlug: blob.seller_slug ?? null,
    sku: blob.reference ?? null,
    // La cuota ACR se calcula client-side en la pagina de producto y no
    // viaja en este payload — se completa en una pasada posterior desde
    // las tarjetas de listado/categoria, que si la traen ya calculada.
    installmentValue: null,
    installmentCount: null,
    originalPrice,
    discountPercentage,
    categoryPath,
  };
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function stripHtml(html: string): string {
  return cheerio.load(html).text().replace(/\s+/g, ' ').trim();
}
