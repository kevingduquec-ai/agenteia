import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductRow } from '@prefiero-ia/database';

const { getProductsByIdsMock, searchProductsByVectorMock } = vi.hoisted(() => ({
  getProductsByIdsMock: vi.fn(),
  searchProductsByVectorMock: vi.fn(),
}));

vi.mock('@prefiero-ia/database', () => ({
  getProductsByIds: getProductsByIdsMock,
  searchProductsByVector: searchProductsByVectorMock,
}));

const { findSemanticProductMatches } = await import('./semantic-search.js');

afterEach(() => {
  vi.clearAllMocks();
});

function row(id: string): ProductRow {
  return {
    id,
    externalId: `sku-${id}`,
    name: `Producto ${id}`,
    slug: `producto-${id}`,
    description: null,
    url: 'https://example.com',
    imageUrl: null,
    brandName: null,
    categoryName: null,
    sellerName: null,
    price: 1000,
    originalPrice: null,
    discountPercentage: null,
    installmentValue: null,
    installmentCount: null,
    currency: 'COP',
    isOffer: false,
    isActive: true,
  };
}

describe('findSemanticProductMatches', () => {
  it('con texto vacio, devuelve vacio sin llamar al proveedor de embeddings ni a la base', async () => {
    const embed = vi.fn();
    const matches = await findSemanticProductMatches('tenant-1', '   ', embed);
    expect(matches).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
    expect(searchProductsByVectorMock).not.toHaveBeenCalled();
  });

  it('sin matches vectoriales, no consulta los productos por id (evita una query vacia)', async () => {
    searchProductsByVectorMock.mockResolvedValueOnce([]);
    const matches = await findSemanticProductMatches('tenant-1', 'algo para dormir mejor', async () => [1, 0, 0]);
    expect(matches).toEqual([]);
    expect(getProductsByIdsMock).not.toHaveBeenCalled();
  });

  it('combina el score del match vectorial con el producto real, preservando el orden de relevancia', async () => {
    searchProductsByVectorMock.mockResolvedValueOnce([
      { productId: 'p1', score: 0.9 },
      { productId: 'p2', score: 0.7 },
    ]);
    getProductsByIdsMock.mockResolvedValueOnce([row('p1'), row('p2')]);

    const matches = await findSemanticProductMatches('tenant-1', 'algo', async () => [1]);
    expect(matches.map((m) => [m.product.id, m.score])).toEqual([
      ['p1', 0.9],
      ['p2', 0.7],
    ]);
  });

  it('descarta un match cuyo producto ya no se puede resolver (ej. desactivado entre la busqueda vectorial y esta consulta)', async () => {
    searchProductsByVectorMock.mockResolvedValueOnce([
      { productId: 'p1', score: 0.9 },
      { productId: 'ya-no-existe', score: 0.8 },
    ]);
    getProductsByIdsMock.mockResolvedValueOnce([row('p1')]);

    const matches = await findSemanticProductMatches('tenant-1', 'algo', async () => [1]);
    expect(matches.map((m) => m.product.id)).toEqual(['p1']);
  });
});
