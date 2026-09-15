import { describe, expect, it } from 'vitest';
import { contentHash } from './hash.js';

describe('contentHash', () => {
  it('es deterministico: las mismas partes siempre dan el mismo hash', () => {
    expect(contentHash(['a', 1, null])).toBe(contentHash(['a', 1, null]));
  });

  it('cambia si cualquier parte cambia (detecta que el producto realmente cambio)', () => {
    expect(contentHash(['Nombre', 1000])).not.toBe(contentHash(['Nombre', 1001]));
  });

  it('trata null y undefined igual (ambos vacios) — no dispara un "cambio" falso al alternar entre los dos', () => {
    expect(contentHash(['a', null, 'b'])).toBe(contentHash(['a', undefined, 'b']));
  });

  it('distingue el orden de las partes (no es solo una bolsa de valores)', () => {
    expect(contentHash(['a', 'b'])).not.toBe(contentHash(['b', 'a']));
  });
});
