import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../pool.js';
import { createTestTenant, testProductInput } from '../../test/fixtures.js';
import {
  listCategorySlugs,
  markStaleProductsInactive,
  updateInstallmentBySku,
  upsertBrand,
  upsertCategoryPath,
  upsertProduct,
  upsertSeller,
} from './catalog.repository.js';

afterAll(async () => {
  await closePool();
});

describe('catalog.repository — upserts', () => {
  it('upsertBrand reutiliza la fila por slug en vez de duplicar', async () => {
    const tenant = await createTestTenant();
    const id1 = await upsertBrand(tenant.id, 'Samsung');
    const id2 = await upsertBrand(tenant.id, 'Samsung');
    expect(id1).toBe(id2);
  });

  it('dos tenants distintos pueden tener, cada uno, una marca con el mismo nombre/slug', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const idA = await upsertBrand(tenantA.id, 'Samsung');
    const idB = await upsertBrand(tenantB.id, 'Samsung');
    expect(idA).not.toBe(idB);
  });

  it('upsertSeller reutiliza por slug', async () => {
    const tenant = await createTestTenant();
    const id1 = await upsertSeller(tenant.id, 'Tienda Uno', 'tienda-uno');
    const id2 = await upsertSeller(tenant.id, 'Tienda Uno', 'tienda-uno');
    expect(id1).toBe(id2);
  });

  it('upsertCategoryPath crea la cadena completa y reutiliza el mismo leaf en la segunda llamada', async () => {
    const tenant = await createTestTenant();
    const path = [
      { name: 'Celulares', slug: 'celulares' },
      { name: 'Smartphones', slug: 'smartphones' },
    ];
    const leaf1 = await upsertCategoryPath(tenant.id, path);
    const leaf2 = await upsertCategoryPath(tenant.id, path);
    expect(leaf1).not.toBeNull();
    expect(leaf1).toBe(leaf2);

    const slugs = await listCategorySlugs(tenant.id);
    expect(slugs).toContain('celulares');
    expect(slugs).toContain('celulares/smartphones');
  });

  it('upsertCategoryPath devuelve null para una ruta vacia', async () => {
    const tenant = await createTestTenant();
    expect(await upsertCategoryPath(tenant.id, [])).toBeNull();
  });

  it('upsertProduct: crea, luego "unchanged" si el contentHash no cambia, luego "updated" si cambia', async () => {
    const tenant = await createTestTenant();
    const input = testProductInput({ contentHash: 'hash-v1' });

    const created = await upsertProduct(tenant.id, input);
    expect(created.status).toBe('created');

    const unchanged = await upsertProduct(tenant.id, input);
    expect(unchanged.status).toBe('unchanged');
    expect(unchanged.id).toBe(created.id);

    const updated = await upsertProduct(tenant.id, { ...input, contentHash: 'hash-v2', price: 999 });
    expect(updated.status).toBe('updated');
    expect(updated.id).toBe(created.id);
  });

  it('el external_id de un producto solo es unico DENTRO de un tenant', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const input = testProductInput({ externalId: 'sku-compartido' });

    const productA = await upsertProduct(tenantA.id, input);
    const productB = await upsertProduct(tenantB.id, input);
    expect(productA.id).not.toBe(productB.id);
  });

  it('upsertProduct reactiva un producto marcado inactivo si vuelve a aparecer sin cambios de contenido', async () => {
    const tenant = await createTestTenant();
    const input = testProductInput();
    const created = await upsertProduct(tenant.id, input);
    await getPool().query('UPDATE products SET is_active = false WHERE id = $1', [created.id]);

    await upsertProduct(tenant.id, input);

    const row = await getPool().query<{ is_active: boolean }>('SELECT is_active FROM products WHERE id = $1', [created.id]);
    expect(row.rows[0].is_active).toBe(true);
  });

  it('updateInstallmentBySku solo actualiza el producto de ESE tenant con ESE sku', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const sku = 'sku-cuota';
    const productA = await upsertProduct(tenantA.id, testProductInput({ externalId: sku }));
    await upsertProduct(tenantB.id, testProductInput({ externalId: sku }));

    const updated = await updateInstallmentBySku(tenantA.id, sku, 50000, 12);
    expect(updated).toBe(true);

    const row = await getPool().query<{ installment_value: string }>('SELECT installment_value FROM products WHERE id = $1', [
      productA.id,
    ]);
    expect(Number(row.rows[0].installment_value)).toBe(50000);
  });

  it('updateInstallmentBySku devuelve false cuando no hay match', async () => {
    const tenant = await createTestTenant();
    expect(await updateInstallmentBySku(tenant.id, 'sku-inexistente', 1, 1)).toBe(false);
  });

  it('markStaleProductsInactive desactiva solo lo de ESE tenant, visto antes del corte, y activo', async () => {
    const tenant = await createTestTenant();
    const stale = await upsertProduct(tenant.id, testProductInput());
    const fresh = await upsertProduct(tenant.id, testProductInput());

    const cutoff = new Date();
    await getPool().query('UPDATE products SET last_seen_at = $2 WHERE id = $1', [stale.id, new Date(cutoff.getTime() - 60_000)]);
    await getPool().query('UPDATE products SET last_seen_at = $2 WHERE id = $1', [fresh.id, new Date(cutoff.getTime() + 60_000)]);

    const deactivated = await markStaleProductsInactive(tenant.id, cutoff);
    expect(deactivated).toBe(1);

    const rows = await getPool().query<{ id: string; is_active: boolean }>('SELECT id, is_active FROM products WHERE id = ANY($1::uuid[])', [
      [stale.id, fresh.id],
    ]);
    const byId = new Map(rows.rows.map((r) => [r.id, r.is_active]));
    expect(byId.get(stale.id)).toBe(false);
    expect(byId.get(fresh.id)).toBe(true);
  });
});
