/** Taxonomia de intenciones — sección 28 del documento maestro. */
export const INTENTS = [
  'GENERAL_CHAT',
  'FAQ',
  'PRODUCT_SEARCH',
  'PRODUCT_RECOMMENDATION',
  'PRODUCT_COMPARISON',
  'PRODUCT_QUESTION',
  'BUDGET_SEARCH',
  'INSTALLMENT_SEARCH',
  'CHEAPER_ALTERNATIVE',
  'SIMILAR_PRODUCT',
  'GIFT_RECOMMENDATION',
  'CREDIT_INFORMATION',
  'WARRANTY_INFORMATION',
  'RETURN_INFORMATION',
  'HUMAN_SUPPORT',
  'PRIVATE_CUSTOMER_DATA',
  'UNKNOWN',
] as const;

export type Intent = (typeof INTENTS)[number];

/** Intenciones que necesitan el catalogo de productos (Fase 5, aun no construida) — mientras tanto se responde honestamente en vez de inventar resultados. */
export const CATALOG_DEPENDENT_INTENTS: ReadonlySet<Intent> = new Set([
  'PRODUCT_SEARCH',
  'PRODUCT_RECOMMENDATION',
  'PRODUCT_COMPARISON',
  'PRODUCT_QUESTION',
  'BUDGET_SEARCH',
  'INSTALLMENT_SEARCH',
  'CHEAPER_ALTERNATIVE',
  'SIMILAR_PRODUCT',
  'GIFT_RECOMMENDATION',
]);

export function isIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value);
}
