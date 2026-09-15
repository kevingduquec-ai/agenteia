import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../pool.js';
import { findTenantByHost, findTenantById, findTenantBySlug, listTenants } from './tenant.repository.js';
import { createTestTenant } from '../../test/fixtures.js';

afterAll(async () => {
  await closePool();
});

describe('tenant.repository', () => {
  it('crea un tenant con los cupos por defecto y lo resuelve por slug/host/id', async () => {
    const tenant = await createTestTenant();

    expect(tenant.maxAdminSeats).toBe(1);
    expect(tenant.maxSupportSeats).toBe(1);
    expect(tenant.isActive).toBe(true);

    expect(await findTenantBySlug(tenant.slug)).toEqual(tenant);
    expect(await findTenantByHost(tenant.host)).toEqual(tenant);
    expect(await findTenantById(tenant.id)).toEqual(tenant);
  });

  it('resuelve el host sin distinguir mayusculas/minusculas — se guarda en minusculas', async () => {
    const tenant = await createTestTenant({ host: `Mixed-Case-${Date.now()}.localhost` });
    expect(tenant.host).toBe(tenant.host.toLowerCase());
    expect(await findTenantByHost(tenant.host.toUpperCase())).toEqual(tenant);
  });

  it('devuelve null para un slug/host/id que no existe', async () => {
    expect(await findTenantBySlug('no-existe-esto')).toBeNull();
    expect(await findTenantByHost('no-existe.localhost')).toBeNull();
    expect(await findTenantById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('rechaza un slug duplicado (evita que dos clientes distintos choquen)', async () => {
    const tenant = await createTestTenant();
    await expect(createTestTenant({ slug: tenant.slug })).rejects.toMatchObject({ code: '23505' });
  });

  it('rechaza un host duplicado', async () => {
    const tenant = await createTestTenant();
    await expect(createTestTenant({ host: tenant.host })).rejects.toMatchObject({ code: '23505' });
  });

  it('listTenants incluye el tenant recien creado', async () => {
    const tenant = await createTestTenant();
    const all = await listTenants();
    expect(all.map((t) => t.id)).toContain(tenant.id);
  });

  it('un tenant inactivo deja de resolverse por host/slug (findTenantByHost/BySlug filtran is_active)', async () => {
    const tenant = await createTestTenant();
    await getPool().query('UPDATE tenants SET is_active = false WHERE id = $1', [tenant.id]);

    expect(await findTenantBySlug(tenant.slug)).toBeNull();
    expect(await findTenantByHost(tenant.host)).toBeNull();
    // findTenantById se usa para resolver el tenant de un token JWT ya
    // emitido — a proposito no filtra is_active (ver su propia firma).
    expect(await findTenantById(tenant.id)).not.toBeNull();
  });

  it('createTenant respeta cupos y origenes CORS explicitos', async () => {
    const tenant = await createTestTenant({ extraCorsOrigins: 'https://a.com,https://b.com', maxAdminSeats: 3, maxSupportSeats: 5 });
    expect(tenant.extraCorsOrigins).toBe('https://a.com,https://b.com');
    expect(tenant.maxAdminSeats).toBe(3);
    expect(tenant.maxSupportSeats).toBe(5);
  });
});
