import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductRow } from '@prefiero-ia/database';

const { getProductBySlugMock } = vi.hoisted(() => ({ getProductBySlugMock: vi.fn() }));
vi.mock('@prefiero-ia/database', () => ({ getProductBySlug: getProductBySlugMock }));

const { resolveProductFromPageContext } = await import('./page-context.js');

afterEach(() => {
  vi.clearAllMocks();
});

function row(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'p1',
    externalId: 'sku-1',
    name: 'iPhone 15',
    slug: 'iphone-15',
    description: null,
    url: 'https://example.com/p/iphone-15',
    imageUrl: null,
    brandName: null,
    categoryName: null,
    sellerName: null,
    price: 3_000_000,
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

describe('resolveProductFromPageContext', () => {
  it('sin contexto (o sin path), devuelve null sin consultar la base', async () => {
    expect(await resolveProductFromPageContext('tenant-1', null)).toBeNull();
    expect(await resolveProductFromPageContext('tenant-1', {})).toBeNull();
    expect(getProductBySlugMock).not.toHaveBeenCalled();
  });

  it('una ruta que no es de producto (/p/<slug>) devuelve null sin consultar la base', async () => {
    expect(await resolveProductFromPageContext('tenant-1', { path: '/carrito' })).toBeNull();
    expect(await resolveProductFromPageContext('tenant-1', { path: '/' })).toBeNull();
    expect(getProductBySlugMock).not.toHaveBeenCalled();
  });

  it('una ruta de producto resuelve el slug DENTRO del tenant', async () => {
    getProductBySlugMock.mockResolvedValueOnce(row());
    const product = await resolveProductFromPageContext('tenant-1', { path: '/p/iphone-15' });
    expect(product?.name).toBe('iPhone 15');
    expect(getProductBySlugMock).toHaveBeenCalledWith('tenant-1', 'iphone-15');
  });

  it('ignora query string/hash y segmentos extra despues del slug', async () => {
    getProductBySlugMock.mockResolvedValueOnce(row());
    await resolveProductFromPageContext('tenant-1', { path: '/p/iphone-15?ref=widget#reviews' });
    expect(getProductBySlugMock).toHaveBeenCalledWith('tenant-1', 'iphone-15');
  });

  it('un slug que ya no existe (producto descontinuado o de otro tenant) devuelve null', async () => {
    getProductBySlugMock.mockResolvedValueOnce(null);
    expect(await resolveProductFromPageContext('tenant-1', { path: '/p/ya-no-existe' })).toBeNull();
  });
});
