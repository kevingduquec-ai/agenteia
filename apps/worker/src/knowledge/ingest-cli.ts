import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runKnowledgeIngest } from './ingest.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
loadEnv({ path: path.join(repoRoot, '.env') });

const delayMs = Number(process.env.CRAWLER_DELAY_MS ?? 800);

console.log(`[ingest-knowledge] delayMs=${delayMs}`);

const summary = await runKnowledgeIngest({ delayMs });

console.log('[ingest-knowledge] resumen:', JSON.stringify(summary, null, 2));

if (summary.errors.length > 0) {
  process.exitCode = 1;
}
