import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../');
loadEnv({ path: path.join(repoRoot, '.env') });

// `getPool()` lee `DATABASE_URL` de forma perezosa, en la primera llamada
// (ver src/pool.ts) — sobreescribirla ANTES de que ningun test la use
// apunta todo el paquete a "prefiero_ia_test" (ver scripts/reset-test-db.mjs)
// en vez de a la base real de desarrollo/produccion.
const baseUrl = process.env.DATABASE_URL;
if (baseUrl) {
  const testUrl = new URL(baseUrl);
  testUrl.pathname = '/prefiero_ia_test';
  process.env.DATABASE_URL = testUrl.toString();
}
