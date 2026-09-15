import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { closePool, createTenant } from '@prefiero-ia/database';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../');
loadEnv({ path: path.join(repoRoot, '.env') });

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function requireArg(name: string): string {
  const value = parseArg(name);
  if (!value) {
    console.error(`Falta --${name}=... Uso:`);
    console.error(
      '  pnpm run create-tenant -- --slug=<slug> --name="<Nombre>" --host=<dominio> --crawler-base-url=<https://sitio-del-cliente.com> [--extra-cors-origins=<url1,url2>] [--max-admin-seats=1] [--max-support-seats=1]',
    );
    process.exit(1);
  }
  return value;
}

const slug = requireArg('slug');
const name = requireArg('name');
const host = requireArg('host');
const crawlerBaseUrl = requireArg('crawler-base-url');
const extraCorsOrigins = parseArg('extra-cors-origins');
const maxAdminSeats = Number(parseArg('max-admin-seats') ?? 1);
const maxSupportSeats = Number(parseArg('max-support-seats') ?? 1);

/**
 * Alta de un cliente nuevo (pedido explicito del usuario: la misma
 * instalacion debe poder atender a mas de un marketplace, distinguiendo
 * cual es cual por la URL). Solo crea la fila en `tenants` — los pasos
 * siguientes (cosechar su catalogo, ingestar su base de conocimiento,
 * crear sus cuentas admin/soporte) son comandos aparte, ver
 * docs/DEPLOYMENT.md.
 */
try {
  const tenant = await createTenant({
    slug,
    name,
    host,
    crawlerBaseUrl,
    extraCorsOrigins,
    maxAdminSeats,
    maxSupportSeats,
  });
  console.log('[create-tenant] creado:', JSON.stringify(tenant, null, 2));
  console.log(`\nSiguientes pasos para "${tenant.slug}":`);
  console.log(`  pnpm run harvest -- --tenant=${tenant.slug}`);
  console.log(`  pnpm run backfill-installments -- --tenant=${tenant.slug}`);
  console.log(`  pnpm --filter @prefiero-ia/worker run backfill-product-embeddings -- --tenant=${tenant.slug}`);
  console.log(`  pnpm run add-knowledge-source -- --tenant=${tenant.slug} --url=<pagina de FAQ/garantia/envios...>  (repetir por cada pagina)`);
  console.log(`  pnpm run ingest-knowledge -- --tenant=${tenant.slug}`);
} catch (error) {
  if (error instanceof Error && 'code' in error && (error as { code: string }).code === '23505') {
    console.error(`Ya existe un tenant con ese slug o ese host.`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await closePool();
}
