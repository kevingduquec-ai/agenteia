import * as cheerio from 'cheerio';
import { extractNextFlightValues, findAllInFlightValues } from './next-flight.js';

export interface ListingCardInstallment {
  sku: string;
  installmentValue: number;
  installmentCount: number;
}

interface RawListingCard {
  sku: string;
  creditInstallment: number;
  installments: number;
}

/**
 * La cuota ACR ("N cuotas de $X") NO viaja en la ficha de producto
 * individual (ver detail-parser.ts) — se calcula client-side ahi. Pero SI
 * viaja, ya calculada por el servidor, en las tarjetas de las paginas de
 * listado/categoria (verificado en vivo contra prefieroacr.com/celulares/
 * celulares-2: cada tarjeta trae "sku", "creditInstallment" e
 * "installments" en el mismo payload de React Server Components que ya usa
 * `extractNextFlightValues`). Esta funcion lee esas tarjetas para
 * completar por SKU lo que la ficha individual deja en null.
 */
function isRawListingCard(value: unknown): value is RawListingCard {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.sku === 'string' && v.sku.length > 0 && typeof v.creditInstallment === 'number' && typeof v.installments === 'number';
}

export function parseListingPage(html: string): ListingCardInstallment[] {
  const $ = cheerio.load(html);
  const flightValues = extractNextFlightValues($);
  const cards = findAllInFlightValues(flightValues, isRawListingCard);

  // Una pagina de listado repite a veces la misma tarjeta en mas de un
  // chunk (ej. seccion "destacados" + grilla principal) — nos quedamos con
  // una fila por SKU.
  const bySku = new Map<string, ListingCardInstallment>();
  for (const card of cards) {
    bySku.set(card.sku, { sku: card.sku, installmentValue: card.creditInstallment, installmentCount: card.installments });
  }
  return [...bySku.values()];
}
