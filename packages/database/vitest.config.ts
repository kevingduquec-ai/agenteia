import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Todos los tests comparten UNA base de test real (ver
    // scripts/reset-test-db.mjs) — correrlos en paralelo en varios
    // procesos multiplicaria pools de conexion sin necesidad; en serie es
    // rapido de sobra al tamaño de este esquema.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
