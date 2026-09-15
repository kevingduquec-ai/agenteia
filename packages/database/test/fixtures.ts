import { randomUUID } from 'node:crypto';
import { createTenant, type CreateTenantInput, type TenantRow } from '../src/repositories/tenant.repository.js';
import type { ProductUpsertInput } from '../src/types.js';

/** Un tenant descartable por test — slug/host unicos evitan choques entre tests que corren en la misma base compartida. */
export async function createTestTenant(overrides: Partial<CreateTenantInput> = {}): Promise<TenantRow> {
  const suffix = randomUUID().slice(0, 8);
  return createTenant({
    slug: `test-${suffix}`,
    name: `Test Tenant ${suffix}`,
    host: `test-${suffix}.localhost`,
    crawlerBaseUrl: 'https://example.com',
    ...overrides,
  });
}

/** Input valido y unico para `upsertProduct` — cada llamada genera su propio SKU/slug/hash para no chocar entre tests. */
export function testProductInput(overrides: Partial<ProductUpsertInput> = {}): ProductUpsertInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    externalId: `sku-${suffix}`,
    name: `Producto de prueba ${suffix}`,
    slug: `producto-de-prueba-${suffix}`,
    description: 'Descripcion de prueba',
    url: `https://example.com/p/producto-${suffix}`,
    imageUrl: null,
    brandId: null,
    categoryId: null,
    sellerId: null,
    price: 100000,
    originalPrice: null,
    discountPercentage: null,
    installmentValue: null,
    installmentCount: null,
    currency: 'COP',
    contentHash: `hash-${suffix}`,
    ...overrides,
  };
}
