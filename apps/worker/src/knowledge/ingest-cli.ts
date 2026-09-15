import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runKnowledgeIngest } from './ingest.js';
import { resolveTenantForCli } from '../tenant-cli.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
loadEnv({ path: path.join(repoRoot, '.env') });

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

const tenant = await resolveTenantForCli(parseArg('tenant'));
const delayMs = Number(process.env.CRAWLER_DELAY_MS ?? 800);

console.log(`[ingest-knowledge] tenant=${tenant.slug} delayMs=${delayMs}`);

const summary = await runKnowledgeIngest({ tenantId: tenant.id, delayMs });

console.log('[ingest-knowledge] resumen:', JSON.stringify(summary, null, 2));

if (summary.errors.length > 0) {
  process.exitCode = 1;
}
