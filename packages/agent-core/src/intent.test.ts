import { describe, expect, it } from 'vitest';
import { CATALOG_DEPENDENT_INTENTS, INTENTS, isIntent } from './intent.js';

describe('intent', () => {
  it('isIntent acepta cualquier valor de la taxonomia', () => {
    for (const intent of INTENTS) {
      expect(isIntent(intent)).toBe(true);
    }
  });

  it('isIntent rechaza texto libre que no es una categoria valida', () => {
    expect(isIntent('ALGO_INVENTADO')).toBe(false);
    expect(isIntent('')).toBe(false);
    expect(isIntent('product_search')).toBe(false); // sensible a mayusculas, como lo espera intent-router
  });

  it('CATALOG_DEPENDENT_INTENTS es un subconjunto real de INTENTS', () => {
    for (const intent of CATALOG_DEPENDENT_INTENTS) {
      expect(INTENTS as readonly string[]).toContain(intent);
    }
  });

  it('HUMAN_SUPPORT/PRIVATE_CUSTOMER_DATA/UNKNOWN nunca son catalog-dependent (tienen su propio corto-circuito en AgentEngine)', () => {
    expect(CATALOG_DEPENDENT_INTENTS.has('HUMAN_SUPPORT')).toBe(false);
    expect(CATALOG_DEPENDENT_INTENTS.has('PRIVATE_CUSTOMER_DATA')).toBe(false);
    expect(CATALOG_DEPENDENT_INTENTS.has('UNKNOWN')).toBe(false);
  });
});
