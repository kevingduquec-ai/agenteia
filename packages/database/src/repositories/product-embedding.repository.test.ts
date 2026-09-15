import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../pool.js';
import { createTestTenant, testProductInput } from '../../test/fixtures.js';
import { upsertProduct } from './catalog.repository.js';
import { findProductsMissingEmbedding, searchProductsByVector, upsertProductEmbedding } from './product-embedding.repository.js';

afterAll(async () => {
  await closePool();
});

/** `product_embeddings.embedding` es `vector(1024)` (ver database/migrations/0008) — un vector unitario en una sola posicion basta para probar el ranking por similitud coseno sin necesitar un embedding real. */
function unitVector(dimensions: number, activeIndex: number): string {
  const values = new Array(dimensions).fill(0);
  values[activeIndex] = 1;
  return `[${values.join(',')}]`;
}

describe('product-embedding.repository', () => {
  it('upsertProductEmbedding es idempotente por producto (ON CONFLICT actualiza, no duplica)', async () => {
    const tenant = await createTestTenant();
    const product = (await upsertProduct(tenant.id, testProductInput())).id;

    await upsertProductEmbedding(product, unitVector(1024, 0), 'qwen-v1');
    await upsertProductEmbedding(product, unitVector(1024, 1), 'qwen-v2');

    const matches = await searchProductsByVector(tenant.id, unitVector(1024, 1), 5);
    expect(matches.find((m) => m.productId === product)?.score).toBeCloseTo(1, 5);
  });

  it('searchProductsByVector esta acotado al catalogo de UN tenant', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const productA = (await upsertProduct(tenantA.id, testProductInput())).id;
    const productB = (await upsertProduct(tenantB.id, testProductInput())).id;
    await upsertProductEmbedding(productA, unitVector(1024, 5), 'qwen-v1');
    await upsertProductEmbedding(productB, unitVector(1024, 5), 'qwen-v1');

    const matchesA = await searchProductsByVector(tenantA.id, unitVector(1024, 5), 10);
    expect(matchesA.map((m) => m.productId)).toContain(productA);
    expect(matchesA.map((m) => m.productId)).not.toContain(productB);
  });

  it('searchProductsByVector nunca incluye productos inactivos', async () => {
    const tenant = await createTestTenant();
    const product = await upsertProduct(tenant.id, testProductInput());
    await upsertProductEmbedding(product.id, unitVector(1024, 2), 'qwen-v1');
    await getPool().query('UPDATE products SET is_active = false WHERE id = $1', [product.id]);

    const matches = await searchProductsByVector(tenant.id, unitVector(1024, 2), 10);
    expect(matches.map((m) => m.productId)).not.toContain(product.id);
  });

  it('findProductsMissingEmbedding solo trae productos activos de ese tenant sin embedding del modelo actual', async () => {
    const tenant = await createTestTenant();
    const withEmbedding = await upsertProduct(tenant.id, testProductInput());
    const withoutEmbedding = await upsertProduct(tenant.id, testProductInput());
    await upsertProductEmbedding(withEmbedding.id, unitVector(1024, 3), 'modelo-actual');

    const missing = await findProductsMissingEmbedding(tenant.id, 'modelo-actual', 50);
    const missingIds = missing.map((p) => p.id);
    expect(missingIds).toContain(withoutEmbedding.id);
    expect(missingIds).not.toContain(withEmbedding.id);
  });
});
