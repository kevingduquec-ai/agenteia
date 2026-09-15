import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const { Client } = pg;

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../');
loadEnv({ path: path.join(repoRoot, '.env') });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error('DATABASE_URL no esta configurada (ver .env.example) — se necesita para saber a que servidor conectar.');
}

const TEST_DB_NAME = 'prefiero_ia_test';

const testUrl = new URL(baseUrl);
testUrl.pathname = `/${TEST_DB_NAME}`;

/**
 * Recrea "prefiero_ia_test" desde cero y aplica TODAS las migraciones de
 * `database/migrations/*.sql` en orden — el mismo esquema exacto que
 * produccion, para que los tests de `packages/database` (y de los e2e de
 * apps/api) corran contra comportamiento real de Postgres/pgvector, no
 * contra un mock de `pg`. Se corre antes de cada `pnpm test` (ver
 * "pretest" en package.json) — cada corrida arranca de una base limpia.
 */
async function main() {
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    // Cierra conexiones que hayan quedado abiertas de una corrida anterior
    // (ej. un pool que no se cerro) — sin esto, DROP DATABASE fallaria con
    // "database is being accessed by other users".
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [
      TEST_DB_NAME,
    ]);
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const test = new Client({ connectionString: testUrl.toString() });
  await test.connect();
  try {
    // Estas extensiones normalmente las aplica infrastructure/postgres/init/
    // al iniciar el CONTENEDOR por primera vez — una base creada despues a
    // mano (como esta) nunca las recibe automaticamente.
    await test.query('CREATE EXTENSION IF NOT EXISTS vector');
    await test.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await test.query('CREATE EXTENSION IF NOT EXISTS unaccent');

    const migrationsDir = path.join(repoRoot, 'database', 'migrations');
    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await test.query(sql);
    }
    console.log(`[reset-test-db] "${TEST_DB_NAME}" lista — ${files.length} migraciones aplicadas.`);
  } finally {
    await test.end();
  }
}

main().catch((error) => {
  console.error('[reset-test-db] fallo:', error);
  process.exitCode = 1;
});
