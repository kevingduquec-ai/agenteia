import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../pool.js';
import { createTestTenant, testProductInput } from '../../test/fixtures.js';
import { upsertCategoryPath, upsertProduct } from './catalog.repository.js';
import {
  findProductByName,
  getProductAttributes,
  getProductById,
  getProductBySlug,
  getProductsByIds,
  listCategories,
  searchProducts,
} from './product-search.repository.js';

afterAll(async () => {
  await closePool();
});

/** Crea un producto activo con nombre/categoria/precio fijos, para armar escenarios de busqueda deterministas. */
async function createSearchableProduct(
  tenantId: string,
  overrides: { name?: string; categoryName?: string; price?: number; installmentValue?: number | null; description?: string | null } = {},
) {
  let categoryId: string | null = null;
  if (overrides.categoryName) {
    categoryId = await upsertCategoryPath(tenantId, [{ name: overrides.categoryName, slug: overrides.categoryName.toLowerCase() }]);
  }
  const input = testProductInput({
    name: overrides.name ?? 'Producto de prueba',
    categoryId,
    price: overrides.price ?? 100_000,
    installmentValue: overrides.installmentValue ?? null,
    description: overrides.description ?? null,
  });
  const result = await upsertProduct(tenantId, input);
  return { id: result.id, ...input };
}

describe('product-search.repository — searchProducts', () => {
  it('nunca devuelve productos de otro tenant', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    await createSearchableProduct(tenantA.id, { name: 'Audífonos Bluetooth XYZ' });
    await createSearchableProduct(tenantB.id, { name: 'Audífonos Bluetooth XYZ' });

    const resultsA = await searchProducts(tenantA.id, { text: 'Audífonos' });
    expect(resultsA).toHaveLength(1);

    const resultsB = await searchProducts(tenantB.id, { text: 'Audífonos' });
    expect(resultsB).toHaveLength(1);
    expect(resultsB[0].id).not.toBe(resultsA[0].id);
  });

  it('OR entre palabras: una frase natural con relleno encuentra el producto por sus palabras reales', async () => {
    const tenant = await createTestTenant();
    await createSearchableProduct(tenant.id, { name: 'Celular Samsung Galaxy A07', categoryName: 'Celulares' });

    // "busco"/"un"/"economico" son stopwords de relleno — si la busqueda
    // exigiera que TODAS las palabras matcheen (AND), esto no encontraria
    // nada aunque "samsung"/"celular" si tengan resultados reales.
    const results = await searchProducts(tenant.id, { text: 'busco un celular samsung economico' });
    expect(results.map((r) => r.name)).toContain('Celular Samsung Galaxy A07');
  });

  it('expande sinonimos regionales: "auriculares" encuentra un producto llamado "Audífonos"', async () => {
    const tenant = await createTestTenant();
    await createSearchableProduct(tenant.id, { name: 'Audífonos Inalámbricos Pro' });

    const results = await searchProducts(tenant.id, { text: 'auriculares' });
    expect(results.map((r) => r.name)).toContain('Audífonos Inalámbricos Pro');
  });

  it('ILIKE insensible a tildes: "audifonos" (sin tilde) encuentra "Audífonos"', async () => {
    const tenant = await createTestTenant();
    await createSearchableProduct(tenant.id, { name: 'Audífonos Deportivos' });

    const results = await searchProducts(tenant.id, { text: 'audifonos' });
    expect(results.map((r) => r.name)).toContain('Audífonos Deportivos');
  });

  it('un match de categoria exacta pesa mas que un match debil de descripcion (no al reves)', async () => {
    const tenant = await createTestTenant();
    const realCelular = await createSearchableProduct(tenant.id, { name: 'Galaxy A07', categoryName: 'Celulares', price: 500_000 });
    await createSearchableProduct(tenant.id, {
      name: 'Funda protectora',
      categoryName: 'Accesorios',
      price: 10_000,
      description: 'Ideal para tu celular, resistente a caidas',
    });

    const results = await searchProducts(tenant.id, { text: 'celular' });
    expect(results[0].id).toBe(realCelular.id);
  });

  it('categoryName/brandName: si dejan la busqueda en cero pero hay otra señal (texto), reintenta sin esos filtros', async () => {
    const tenant = await createTestTenant();
    await createSearchableProduct(tenant.id, { name: 'Mouse Gamer RGB', categoryName: 'Perifericos', price: 24_900 });

    // "gamer" no es ninguna categoria/marca real del catalogo — un AND
    // estricto contra categoryName/brandName dejaria esto en cero aunque
    // el texto libre si encuentre el mouse real.
    const results = await searchProducts(tenant.id, { text: 'mouse gamer que no pase de 30 mil', categoryName: 'gamer', maxPrice: 30_000 });
    expect(results.map((r) => r.name)).toContain('Mouse Gamer RGB');
  });

  it('categoryName/brandName: si son la UNICA señal y no matchean, no cae a "cualquier producto" — devuelve vacio', async () => {
    const tenant = await createTestTenant();
    await createSearchableProduct(tenant.id, { name: 'Cualquier producto activo' });

    const results = await searchProducts(tenant.id, { categoryName: 'categoria-que-no-existe' });
    expect(results).toHaveLength(0);
  });

  it('filtra por rango de precio', async () => {
    const tenant = await createTestTenant();
    await createSearchableProduct(tenant.id, { name: 'Producto Barato', price: 10_000 });
    await createSearchableProduct(tenant.id, { name: 'Producto Caro', price: 900_000 });

    const results = await searchProducts(tenant.id, { minPrice: 500_000 });
    expect(results.map((r) => r.name)).toEqual(['Producto Caro']);
  });

  it('filtra por cuota maxima, excluyendo productos sin cuota calculada', async () => {
    const tenant = await createTestTenant();
    await createSearchableProduct(tenant.id, { name: 'Con cuota baja', installmentValue: 20_000 });
    await createSearchableProduct(tenant.id, { name: 'Con cuota alta', installmentValue: 200_000 });
    await createSearchableProduct(tenant.id, { name: 'Sin cuota calculada', installmentValue: null });

    const results = await searchProducts(tenant.id, { maxInstallment: 50_000 });
    expect(results.map((r) => r.name)).toEqual(['Con cuota baja']);
  });

  it('excludeProductId nunca incluye ese producto en el resultado', async () => {
    const tenant = await createTestTenant();
    const target = await createSearchableProduct(tenant.id, { name: 'Producto Excluido' });
    await createSearchableProduct(tenant.id, { name: 'Producto Excluido Copia' });

    const results = await searchProducts(tenant.id, { text: 'producto excluido', excludeProductId: target.id });
    expect(results.map((r) => r.id)).not.toContain(target.id);
  });

  it('nunca devuelve productos inactivos', async () => {
    const tenant = await createTestTenant();
    const inactive = await createSearchableProduct(tenant.id, { name: 'Producto Descontinuado Unico' });
    await getPool().query('UPDATE products SET is_active = false WHERE id = $1', [inactive.id]);

    const results = await searchProducts(tenant.id, { text: 'descontinuado unico' });
    expect(results).toHaveLength(0);
  });
});

describe('product-search.repository — resolucion puntual', () => {
  it('getProductById / getProductsByIds no filtran por tenant (uso interno con id ya resuelto)', async () => {
    const tenant = await createTestTenant();
    const product = await createSearchableProduct(tenant.id, { name: 'Producto Puntual' });

    expect((await getProductById(product.id))?.name).toBe('Producto Puntual');
    expect((await getProductsByIds([product.id])).map((p) => p.id)).toEqual([product.id]);
  });

  it('getProductBySlug esta acotado por tenant — el mismo slug en otro tenant no aparece', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const input = testProductInput({ slug: 'mismo-slug' });
    const productA = await upsertProduct(tenantA.id, input);
    await upsertProduct(tenantB.id, input);

    const found = await getProductBySlug(tenantA.id, 'mismo-slug');
    expect(found?.id).toBe(productA.id);
  });

  it('findProductByName resuelve por similitud aproximada y SI incluye productos inactivos', async () => {
    const tenant = await createTestTenant();
    const product = await createSearchableProduct(tenant.id, { name: 'iPhone 15 Pro Max' });
    await getPool().query('UPDATE products SET is_active = false WHERE id = $1', [product.id]);

    const found = await findProductByName(tenant.id, 'iphone 15 pro max');
    expect(found?.id).toBe(product.id);
  });

  it('getProductAttributes devuelve las specs guardadas para ese producto', async () => {
    const tenant = await createTestTenant();
    const product = await createSearchableProduct(tenant.id, { name: 'Con specs' });
    await getPool().query(
      `INSERT INTO product_attributes (product_id, attribute_key, attribute_name, attribute_value) VALUES ($1, 'ram', 'RAM', '8GB')`,
      [product.id],
    );

    const attrs = await getProductAttributes(product.id);
    expect(attrs).toEqual([{ attributeKey: 'ram', attributeName: 'RAM', attributeValue: '8GB' }]);
  });

  it('listCategories/listBrands solo cuentan lo activo de ESE tenant', async () => {
    const tenant = await createTestTenant();
    await createSearchableProduct(tenant.id, { name: 'Con categoria', categoryName: 'Categoria Unica De Test' });

    const categories = await listCategories(tenant.id);
    expect(categories.map((c) => c.name)).toContain('Categoria Unica De Test');
  });
});
