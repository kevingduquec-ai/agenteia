import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { addKnowledgeSource, closePool } from '@prefiero-ia/database';
import { resolveTenantForCli } from '../tenant-cli.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
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
      '  pnpm run add-knowledge-source -- --tenant=<slug> --url=<https://sitio-del-cliente.com/preguntas-frecuentes> [--kind=heading|frequent-questions-api] [--source-url=<url a mostrar, solo si --url es un endpoint de API>] [--headers=\'{"Header":"valor"}\']',
    );
    process.exit(1);
  }
  return value;
}

const tenant = await resolveTenantForCli(parseArg('tenant'));
const url = requireArg('url');
const sourceUrl = parseArg('source-url');
const headersArg = parseArg('headers');
const headers = headersArg ? (JSON.parse(headersArg) as Record<string, string>) : null;

const kindArg = parseArg('kind') ?? 'heading';
if (kindArg !== 'heading' && kindArg !== 'frequent-questions-api') {
  console.error(`--kind debe ser "heading" o "frequent-questions-api", recibido: "${kindArg}"`);
  process.exit(1);
}
const kind = kindArg;

/**
 * Agrega una pagina/endpoint a la base de conocimiento (FAQ, garantia,
 * envios, politicas...) de un tenant especifico — reemplaza la vieja
 * lista fija que vivia en `apps/worker/src/knowledge/sources.ts` (siempre
 * traia el contenido de Prefiero ACR+, sin importar el tenant), ver
 * docs/MULTI-TENANCY.md. Solo registra la fuente; correr
 * `pnpm run ingest-knowledge -- --tenant=<slug>` despues para ingestarla
 * de verdad.
 */
try {
  const source = await addKnowledgeSource(tenant.id, { url, kind, sourceUrl, headers });
  console.log(`[add-knowledge-source] agregada para "${tenant.slug}":`, JSON.stringify(source, null, 2));
  console.log(`\nSiguiente paso: pnpm run ingest-knowledge -- --tenant=${tenant.slug}`);
} finally {
  await closePool();
}
