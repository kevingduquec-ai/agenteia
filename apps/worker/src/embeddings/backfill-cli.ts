import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runProductEmbeddingBackfillCli } from './index.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
loadEnv({ path: path.join(repoRoot, '.env') });

await runProductEmbeddingBackfillCli();
