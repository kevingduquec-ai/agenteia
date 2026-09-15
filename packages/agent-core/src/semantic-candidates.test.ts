import { describe, expect, it, vi } from 'vitest';
import type { ProductSummary, SemanticMatch } from '@prefiero-ia/catalog';

const { findSemanticProductMatchesMock } = vi.hoisted(() => ({ findSemanticProductMatchesMock: vi.fn() }));
vi.mock('@prefiero-ia/catalog', () => ({ findSemanticProductMatches: findSemanticProductMatchesMock }));

const { mergeSemanticCandidates, safeSemanticMatches } = await import('./semantic-candidates.js');

function product(id: string): ProductSummary {
  return {
    id,
    name: `Producto ${id}`,
    url: 'https://example.com',
    imageUrl: null,
    price: 1000,
    originalPrice: null,
    discountPercentage: null,
    installmentValue: null,
    installmentCount: null,
    currency: 'COP',
    isOffer: false,
    isActive: true,
    categoryName: null,
    brandName: null,
    sellerName: null,
  };
}

describe('safeSemanticMatches', () => {
  it('sin funcion "embed", devuelve vacio sin llamar a la busqueda semantica', async () => {
    const matches = await safeSemanticMatches('tenant-1', 'algo', undefined);
    expect(matches).toEqual([]);
    expect(findSemanticProductMatchesMock).not.toHaveBeenCalled();
  });

  it('si la busqueda semantica falla, devuelve vacio en vez de propagar el error', async () => {
    findSemanticProductMatchesMock.mockRejectedValueOnce(new Error('sin product_embeddings poblado'));
    const matches = await safeSemanticMatches('tenant-1', 'algo', async () => [1]);
    expect(matches).toEqual([]);
  });

  it('si la busqueda semantica funciona, devuelve sus resultados tal cual', async () => {
    const semanticMatches: SemanticMatch[] = [{ product: product('p1'), score: 0.8 }];
    findSemanticProductMatchesMock.mockResolvedValueOnce(semanticMatches);
    const matches = await safeSemanticMatches('tenant-1', 'algo', async () => [1]);
    expect(matches).toEqual(semanticMatches);
  });
});

describe('mergeSemanticCandidates', () => {
  it('un producto que aparece en ambas listas conserva su semanticScore real, sin duplicarse', () => {
    const literal = [product('p1'), product('p2')];
    const semantic: SemanticMatch[] = [{ product: product('p1'), score: 0.9 }];

    const merged = mergeSemanticCandidates(literal, semantic);
    expect(merged).toHaveLength(2);
    expect(merged.find((c) => c.product.id === 'p1')?.semanticScore).toBe(0.9);
    expect(merged.find((c) => c.product.id === 'p2')?.semanticScore).toBeUndefined();
  });

  it('un producto que solo aparece en la busqueda semantica se agrega al final', () => {
    const literal = [product('p1')];
    const semantic: SemanticMatch[] = [{ product: product('p2'), score: 0.7 }];

    const merged = mergeSemanticCandidates(literal, semantic);
    expect(merged.map((c) => c.product.id)).toEqual(['p1', 'p2']);
  });
});
