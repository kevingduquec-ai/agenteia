import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductRow } from '@prefiero-ia/database';

const { findProductByNameMock, getProductAttributesMock, getProductByIdMock, searchProductsMock } = vi.hoisted(() => ({
  findProductByNameMock: vi.fn(),
  getProductAttributesMock: vi.fn().mockResolvedValue([]),
  getProductByIdMock: vi.fn(),
  searchProductsMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('@prefiero-ia/database', () => ({
  findProductByName: findProductByNameMock,
  getProductAttributes: getProductAttributesMock,
  getProductById: getProductByIdMock,
}));
vi.mock('./search.js', () => ({ searchProducts: searchProductsMock }));

const { findCheaperAlternatives, findSimilarProducts, resolveProduct, resolveProducts } = await import('./product-detail.js');

afterEach(() => {
  vi.clearAllMocks();
  getProductAttributesMock.mockResolvedValue([]);
  searchProductsMock.mockResolvedValue([]);
});

function row(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'p1',
    externalId: 'sku-1',
    name: 'Producto',
    slug: 'producto',
    description: null,
    url: 'https://example.com/p/producto',
    imageUrl: null,
    brandName: null,
    categoryName: 'Celulares',
    sellerName: null,
    price: 100_000,
    originalPrice: null,
    discountPercentage: null,
    installmentValue: null,
    installmentCount: null,
    currency: 'COP',
    isOffer: false,
    isActive: true,
    ...overrides,
  };
}

describe('resolveProduct', () => {
  it('con un UUID valido, resuelve por id (nunca por nombre)', async () => {
    getProductByIdMock.mockResolvedValueOnce(row({ id: '550e8400-e29b-41d4-a716-446655440000' }));
    const product = await resolveProduct('tenant-1', '550e8400-e29b-41d4-a716-446655440000');
    expect(product?.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(findProductByNameMock).not.toHaveBeenCalled();
  });

  it('con texto que no es UUID, resuelve por nombre mas parecido DENTRO del tenant', async () => {
    findProductByNameMock.mockResolvedValueOnce(row({ name: 'iPhone 15 Pro' }));
    const product = await resolveProduct('tenant-1', 'iphone 15 pro');
    expect(product?.name).toBe('iPhone 15 Pro');
    expect(findProductByNameMock).toHaveBeenCalledWith('tenant-1', 'iphone 15 pro');
    expect(getProductByIdMock).not.toHaveBeenCalled();
  });

  it('devuelve null si no encuentra nada, sin pedir atributos', async () => {
    findProductByNameMock.mockResolvedValueOnce(null);
    const product = await resolveProduct('tenant-1', 'no existe esto');
    expect(product).toBeNull();
    expect(getProductAttributesMock).not.toHaveBeenCalled();
  });

  it('incluye los atributos/specs del producto resuelto', async () => {
    getProductByIdMock.mockResolvedValueOnce(row({ id: '550e8400-e29b-41d4-a716-446655440000' }));
    getProductAttributesMock.mockResolvedValueOnce([{ attributeKey: 'ram', attributeName: 'RAM', attributeValue: '8GB' }]);
    const product = await resolveProduct('tenant-1', '550e8400-e29b-41d4-a716-446655440000');
    expect(product?.attributes).toEqual([{ attributeKey: 'ram', attributeName: 'RAM', attributeValue: '8GB' }]);
  });
});

describe('resolveProducts', () => {
  it('filtra los que no se pudieron resolver, sin fallar por uno solo', async () => {
    findProductByNameMock.mockResolvedValueOnce(row({ id: 'p1', name: 'Existe' })).mockResolvedValueOnce(null);
    const products = await resolveProducts('tenant-1', ['existe', 'no existe']);
    expect(products.map((p) => p.name)).toEqual(['Existe']);
  });
});

describe('findSimilarProducts', () => {
  it('busca en la misma categoria, en un rango de precio ±40%, excluyendo al propio producto', async () => {
    getProductByIdMock.mockResolvedValueOnce(row({ id: 'ref-1', price: 100_000, categoryName: 'Celulares' }));
    await findSimilarProducts('tenant-1', { productId: 'ref-1' });

    expect(searchProductsMock).toHaveBeenCalledWith('tenant-1', {
      categoryName: 'Celulares',
      minPrice: 60_000,
      maxPrice: 140_000,
      excludeProductId: 'ref-1',
      limit: 6,
    });
  });

  it('si el producto de referencia no existe, devuelve vacio sin llamar a la busqueda', async () => {
    getProductByIdMock.mockResolvedValueOnce(null);
    const results = await findSimilarProducts('tenant-1', { productId: 'no-existe' });
    expect(results).toEqual([]);
    expect(searchProductsMock).not.toHaveBeenCalled();
  });
});

describe('findCheaperAlternatives', () => {
  it('busca en la misma categoria con precio maximo igual al de referencia, excluyendolo', async () => {
    getProductByIdMock.mockResolvedValueOnce(row({ id: 'ref-1', price: 200_000, categoryName: 'Portátiles' }));
    await findCheaperAlternatives('tenant-1', { productId: 'ref-1' });

    expect(searchProductsMock).toHaveBeenCalledWith('tenant-1', {
      categoryName: 'Portátiles',
      maxPrice: 200_000,
      excludeProductId: 'ref-1',
      limit: 6,
    });
  });
});
