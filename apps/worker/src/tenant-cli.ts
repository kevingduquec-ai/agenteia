import { findTenantBySlug, listTenants, type TenantRow } from '@prefiero-ia/database';

/**
 * Resuelve sobre que tenant corre un comando de CLI del worker (harvest,
 * backfill-installments, ingest-knowledge, backfill-product-embeddings) —
 * cada uno de estos jobs procesa UN cliente a la vez, nunca todos de
 * golpe (cada tenant tiene su propio `crawler_base_url`, su propio
 * catalogo, su propia base de conocimiento).
 *
 * Prioridad: `--tenant=<slug>` explicito > `DEFAULT_TENANT_SLUG` del
 * `.env` (comodo para desarrollo local con un solo cliente) > si solo
 * existe un tenant en la base, ese unico tenant.
 */
export async function resolveTenantForCli(explicitSlug?: string): Promise<TenantRow> {
  if (explicitSlug) {
    const tenant = await findTenantBySlug(explicitSlug);
    if (!tenant) {
      throw new Error(`No existe un tenant con slug "${explicitSlug}".`);
    }
    return tenant;
  }

  const fallbackSlug = process.env.DEFAULT_TENANT_SLUG;
  if (fallbackSlug) {
    const tenant = await findTenantBySlug(fallbackSlug);
    if (!tenant) {
      throw new Error(`DEFAULT_TENANT_SLUG="${fallbackSlug}" (.env) no corresponde a ningun tenant real.`);
    }
    return tenant;
  }

  const all = await listTenants();
  if (all.length === 1) {
    return all[0];
  }
  if (all.length === 0) {
    throw new Error('No hay ningun tenant creado todavia — crea uno primero (ver docs/DEPLOYMENT.md).');
  }
  throw new Error(
    `Hay ${all.length} tenants (${all.map((t) => t.slug).join(', ')}) — especifica cual con --tenant=<slug>.`,
  );
}
