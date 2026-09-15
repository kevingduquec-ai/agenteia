import { getPool } from '../pool.js';
import { slugify } from '../slugify.js';
import type { CategoryPathSegment, ProductUpsertInput, UpsertProductResult } from '../types.js';

export async function upsertBrand(tenantId: string, name: string): Promise<string> {
  const pool = getPool();
  const slug = slugify(name);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO brands (tenant_id, name, slug) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [tenantId, name, slug],
  );
  return result.rows[0].id;
}

export async function upsertSeller(tenantId: string, name: string, slug: string): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO sellers (tenant_id, name, slug) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [tenantId, name, slug || slugify(name)],
  );
  return result.rows[0].id;
}

/**
 * Crea (o reutiliza) la cadena completa de categorias de un breadcrumb,
 * usando la ruta acumulada como slug unico (por tenant) para no chocar
 * entre categorias de distinto padre que comparten nombre de hoja.
 */
export async function upsertCategoryPath(tenantId: string, segments: CategoryPathSegment[]): Promise<string | null> {
  if (segments.length === 0) {
    return null;
  }

  const pool = getPool();
  let parentId: string | null = null;
  let cumulativeSlug = '';
  let leafId: string | null = null;

  for (const segment of segments) {
    cumulativeSlug = cumulativeSlug ? `${cumulativeSlug}/${segment.slug}` : segment.slug;
    const result: { rows: { id: string }[] } = await pool.query(
      `INSERT INTO categories (tenant_id, name, slug, parent_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id
       RETURNING id`,
      [tenantId, segment.name, cumulativeSlug, parentId],
    );
    const newLeafId: string = result.rows[0].id;
    leafId = newLeafId;
    parentId = newLeafId;
  }

  return leafId;
}

export async function upsertProduct(tenantId: string, input: ProductUpsertInput): Promise<UpsertProductResult> {
  const pool = getPool();
  const existing = await pool.query<{ id: string; content_hash: string | null }>(
    'SELECT id, content_hash FROM products WHERE tenant_id = $1 AND external_id = $2',
    [tenantId, input.externalId],
  );

  const now = new Date();

  if (existing.rows.length === 0) {
    const insert = await pool.query<{ id: string }>(
      `INSERT INTO products (
         tenant_id, external_id, name, slug, description, url, image_url,
         brand_id, category_id, seller_id,
         price, original_price, discount_percentage,
         installment_value, installment_count, currency,
         content_hash, last_seen_at, last_scraped_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)
       RETURNING id`,
      [
        tenantId,
        input.externalId,
        input.name,
        input.slug,
        input.description,
        input.url,
        input.imageUrl,
        input.brandId,
        input.categoryId,
        input.sellerId,
        input.price,
        input.originalPrice,
        input.discountPercentage,
        input.installmentValue,
        input.installmentCount,
        input.currency,
        input.contentHash,
        now,
      ],
    );
    const id = insert.rows[0].id;
    await insertPriceHistory(id, input);
    return { id, status: 'created' };
  }

  const productId = existing.rows[0].id;
  const changed = existing.rows[0].content_hash !== input.contentHash;

  if (changed) {
    await pool.query(
      `UPDATE products SET
         name = $2, description = $3, url = $4, image_url = $5,
         brand_id = $6, category_id = $7, seller_id = $8,
         price = $9, original_price = $10, discount_percentage = $11,
         installment_value = $12, installment_count = $13, currency = $14,
         content_hash = $15, last_seen_at = $16, last_scraped_at = $16, updated_at = $16,
         is_active = true
       WHERE id = $1`,
      [
        productId,
        input.name,
        input.description,
        input.url,
        input.imageUrl,
        input.brandId,
        input.categoryId,
        input.sellerId,
        input.price,
        input.originalPrice,
        input.discountPercentage,
        input.installmentValue,
        input.installmentCount,
        input.currency,
        input.contentHash,
        now,
      ],
    );
    await insertPriceHistory(productId, input);
  } else {
    // Aunque el contenido no cambio, si se pudo re-scrapear con exito es
    // prueba de que sigue existiendo — reactiva si venia de un ciclo
    // anterior donde `markStaleProductsInactive` lo marco como descontinuado.
    await pool.query('UPDATE products SET last_seen_at = $2, last_scraped_at = $2, is_active = true WHERE id = $1', [
      productId,
      now,
    ]);
  }

  return { id: productId, status: changed ? 'updated' : 'unchanged' };
}

/**
 * Segunda pasada del crawler (ver apps/worker/src/crawler/listing-parser.ts):
 * completa la cuota ACR que la ficha individual del producto deja en null
 * (se calcula client-side ahi) usando lo que si trae ya calculado la
 * tarjeta de una pagina de listado/categoria. Solo toca esas dos columnas
 * — nunca reescribe nombre/precio/categoria, que ya mantiene al dia la
 * cosecha normal (`upsertProduct`). El SKU solo es unico DENTRO de un
 * tenant (dos tenants distintos pueden tener, cada uno, un producto con
 * el mismo SKU en su sitio de origen) — sin filtrar por tenant_id aqui se
 * arriesga actualizar el producto equivocado de otro cliente.
 */
export async function updateInstallmentBySku(
  tenantId: string,
  sku: string,
  installmentValue: number,
  installmentCount: number,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE products SET installment_value = $3, installment_count = $4, updated_at = now()
     WHERE tenant_id = $1 AND external_id = $2`,
    [tenantId, sku, installmentValue, installmentCount],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Slugs de categoria ya conocidos de ESTE tenant (de su propia cosecha de productos) — son las paginas de listado que la segunda pasada visita para completar la cuota. */
export async function listCategorySlugs(tenantId: string): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query<{ slug: string }>('SELECT slug FROM categories WHERE tenant_id = $1 ORDER BY slug', [
    tenantId,
  ]);
  return result.rows.map((row) => row.slug);
}

async function insertPriceHistory(productId: string, input: ProductUpsertInput): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO product_price_history (product_id, price, original_price, installment_value)
     VALUES ($1, $2, $3, $4)`,
    [productId, input.price, input.originalPrice, input.installmentValue],
  );
}

/**
 * El catalogo real cambia todo el tiempo: un producto que ya no aparece en
 * una cosecha completa (no se le toco `last_seen_at`) probablemente fue
 * descontinuado o retirado del sitio. Sin este paso, `products.is_active`
 * se queda pegado en `true` para siempre y el catalogo local se desincroniza
 * silenciosamente del real. Solo debe llamarse tras una cosecha SIN limite
 * (`--limit` deja fuera la mayoria del catalogo a proposito, marcarlo como
 * "desaparecido" seria un falso positivo masivo) — y solo del tenant que
 * se acaba de cosechar, nunca de todos a la vez.
 */
export async function markStaleProductsInactive(tenantId: string, seenBefore: Date): Promise<number> {
  const pool = getPool();
  const result = await pool.query('UPDATE products SET is_active = false WHERE tenant_id = $1 AND is_active AND last_seen_at < $2', [
    tenantId,
    seenBefore,
  ]);
  return result.rowCount ?? 0;
}
