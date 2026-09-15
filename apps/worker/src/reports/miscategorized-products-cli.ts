import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { closePool } from '@prefiero-ia/database';
import { resolveTenantForCli } from '../tenant-cli.js';
import { findMiscategorizedCandidates } from './miscategorized-products.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
loadEnv({ path: path.join(repoRoot, '.env') });

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

/**
 * Reporte de solo lectura: productos cuyo nombre sugiere fuertemente una
 * categoria distinta a la que tienen asignada en el catalogo de origen.
 * Nunca cambia nada — es insumo para que Qubit se lo reporte a ACR+ (la
 * categorizacion mala viene de su sitio, no de este crawler). Ver
 * miscategorized-products.ts para el criterio exacto de cada señal.
 */
const tenant = await resolveTenantForCli(parseArg('tenant'));
const candidates = await findMiscategorizedCandidates(tenant.id);

console.log(`[report-miscategorized] tenant="${tenant.slug}" — ${candidates.length} candidatos a revisar (no son errores confirmados)\n`);

const bySignal = new Map<string, typeof candidates>();
for (const candidate of candidates) {
  const group = bySignal.get(candidate.matchedSignal) ?? [];
  group.push(candidate);
  bySignal.set(candidate.matchedSignal, group);
}

for (const [signal, group] of bySignal) {
  console.log(`\n== ${signal} (${group.length}) ==`);
  for (const candidate of group) {
    console.log(`- "${candidate.name}" -> categoría actual: "${candidate.categoryName ?? '(sin categoría)'}"  ${candidate.url}`);
  }
}

await closePool();
