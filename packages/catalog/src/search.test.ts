import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductRow } from '@prefiero-ia/database';

const { searchProductsInDbMock } = vi.hoisted(() => ({ searchProductsInDbMock: vi.fn() }));
vi.mock('@prefiero-ia/database', () => ({ searchProducts: searchProductsInDbMock }));

const { searchProducts } = await import('./search.js');

afterEach(() => {
  vi.clearAllMocks();
});

describe('searchProducts (packages/catalog)', () => {
  it('pasa el tenantId/filtros a la capa de base y traduce cada fila a ProductSummary (sin filtrar columnas internas)', async () => {
    const row: ProductRow = {
      id: 'p1',
      externalId: 'sku-1',
      name: 'Producto',
      slug: 'producto',
      description: null,
      url: 'https://example.com',
      imageUrl: null,
      brandName: 'Marca',
      categoryName: 'Categoria',
      sellerName: 'Vendedor',
      price: 1000,
      originalPrice: null,
      discountPercentage: null,
      installmentValue: null,
      installmentCount: null,
      currency: 'COP',
      isOffer: false,
      isActive: true,
    };
    searchProductsInDbMock.mockResolvedValueOnce([row]);

    const results = await searchProducts('tenant-1', { text: 'producto' });
    expect(searchProductsInDbMock).toHaveBeenCalledWith('tenant-1', { text: 'producto' });
    expect(results).toEqual([
      {
        id: 'p1',
        name: 'Producto',
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
        categoryName: 'Categoria',
        brandName: 'Marca',
        sellerName: 'Vendedor',
      },
    ]);
    expect(results[0]).not.toHaveProperty('externalId');
  });
});
