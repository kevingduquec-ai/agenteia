import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runInstallmentsBackfill } from './backfill-installments.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
loadEnv({ path: path.join(repoRoot, '.env') });

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

const baseUrl = process.env.CRAWLER_BASE_URL || 'https://prefieroacr.com';
const delayMs = Number(parseArg('delay') ?? process.env.CRAWLER_DELAY_MS ?? 800);
const limitArg = parseArg('limit');
const limit = limitArg ? Number(limitArg) : undefined;

console.log(
  `[backfill-installments] baseUrl=${baseUrl} delayMs=${delayMs} limit=${limit ?? 'sin limite (todas las categorias conocidas)'}`,
);

const summary = await runInstallmentsBackfill({ baseUrl, delayMs, limit }, (done, total) => {
  process.stdout.write(`\r[backfill-installments] ${done}/${total} categorias visitadas`);
});

console.log('\n[backfill-installments] resumen:', JSON.stringify(summary, null, 2));

if (summary.categoriesFailed > 0 && summary.productsUpdated === 0) {
  process.exitCode = 1;
}
