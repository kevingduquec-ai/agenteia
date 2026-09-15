import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../pool.js';
import { createTestTenant } from '../../test/fixtures.js';
import { insertUnmetDemand } from './unmet-demand.repository.js';

afterAll(async () => {
  await closePool();
});

describe('unmet-demand.repository', () => {
  it('registra una demanda no atendida con el tenant correcto', async () => {
    const tenant = await createTestTenant();
    const { id } = await insertUnmetDemand(tenant.id, {
      query: 'busco una nevera no frost economica',
      requestedCategory: 'Neveras',
      requestedBrand: null,
      budget: 500_000,
    });

    const row = await getPool().query<{ tenant_id: string; requested_category: string | null; budget: string | null }>(
      'SELECT tenant_id, requested_category, budget FROM unmet_demands WHERE id = $1',
      [id],
    );
    expect(row.rows[0].tenant_id).toBe(tenant.id);
    expect(row.rows[0].requested_category).toBe('Neveras');
    expect(Number(row.rows[0].budget)).toBe(500_000);
  });

  it('acepta campos opcionales ausentes sin fallar', async () => {
    const tenant = await createTestTenant();
    await expect(insertUnmetDemand(tenant.id, { query: 'algo raro que no tenemos' })).resolves.toHaveProperty('id');
  });
});
