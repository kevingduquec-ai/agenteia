import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runHarvest } from './harvest.js';
import { resolveTenantForCli } from '../tenant-cli.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
loadEnv({ path: path.join(repoRoot, '.env') });

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

const tenant = await resolveTenantForCli(parseArg('tenant'));
const baseUrl = tenant.crawlerBaseUrl;
const delayMs = Number(parseArg('delay') ?? process.env.CRAWLER_DELAY_MS ?? 800);
const limitArg = parseArg('limit');
const limit = limitArg ? Number(limitArg) : undefined;

console.log(
  `[harvest] tenant=${tenant.slug} baseUrl=${baseUrl} delayMs=${delayMs} limit=${limit ?? 'sin limite (catalogo completo)'}`,
);

const summary = await runHarvest({ tenantId: tenant.id, baseUrl, delayMs, limit }, (done, total) => {
  process.stdout.write(`\r[harvest] ${done}/${total} productos procesados`);
});

console.log('\n[harvest] resumen:', JSON.stringify(summary, null, 2));

if (summary.failed > 0) {
  process.exitCode = 1;
}
