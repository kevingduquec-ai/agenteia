import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '../pool.js';
import { createTestTenant } from '../../test/fixtures.js';
import { addKnowledgeSource, deleteKnowledgeSource, listKnowledgeSourcesByTenant } from './knowledge-source.repository.js';

afterAll(async () => {
  await closePool();
});

describe('knowledge-source.repository', () => {
  it('agrega una fuente y la lista solo para su propio tenant', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();

    await addKnowledgeSource(tenantA.id, { url: 'https://cliente-a.com/faq', kind: 'heading' });

    expect(await listKnowledgeSourcesByTenant(tenantA.id)).toHaveLength(1);
    expect(await listKnowledgeSourcesByTenant(tenantB.id)).toHaveLength(0);
  });

  it('es idempotente: agregar la misma URL dos veces actualiza en vez de duplicar', async () => {
    const tenant = await createTestTenant();
    await addKnowledgeSource(tenant.id, { url: 'https://cliente.com/faq', kind: 'heading' });
    await addKnowledgeSource(tenant.id, { url: 'https://cliente.com/faq', kind: 'frequent-questions-api', sourceUrl: 'https://cliente.com/contacto' });

    const sources = await listKnowledgeSourcesByTenant(tenant.id);
    expect(sources).toHaveLength(1);
    expect(sources[0].kind).toBe('frequent-questions-api');
    expect(sources[0].sourceUrl).toBe('https://cliente.com/contacto');
  });

  it('dos tenants distintos pueden registrar la misma URL sin chocar (UNIQUE es por tenant+url)', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const url = 'https://mismo-dominio-compartido.com/faq';

    await addKnowledgeSource(tenantA.id, { url, kind: 'heading' });
    await addKnowledgeSource(tenantB.id, { url, kind: 'heading' });

    expect(await listKnowledgeSourcesByTenant(tenantA.id)).toHaveLength(1);
    expect(await listKnowledgeSourcesByTenant(tenantB.id)).toHaveLength(1);
  });

  it('guarda y devuelve headers como objeto', async () => {
    const tenant = await createTestTenant();
    const source = await addKnowledgeSource(tenant.id, {
      url: 'https://cliente.com/api/faq',
      kind: 'frequent-questions-api',
      sourceUrl: 'https://cliente.com/contacto',
      headers: { 'Token-Client': 'abc123' },
    });
    expect(source.headers).toEqual({ 'Token-Client': 'abc123' });
  });

  it('deleteKnowledgeSource solo borra la fuente de SU tenant, nunca la de otro', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const source = await addKnowledgeSource(tenantA.id, { url: 'https://cliente-a.com/faq', kind: 'heading' });

    const deletedByWrongTenant = await deleteKnowledgeSource(tenantB.id, source.id);
    expect(deletedByWrongTenant).toBe(false);
    expect(await listKnowledgeSourcesByTenant(tenantA.id)).toHaveLength(1);

    const deletedByOwner = await deleteKnowledgeSource(tenantA.id, source.id);
    expect(deletedByOwner).toBe(true);
    expect(await listKnowledgeSourcesByTenant(tenantA.id)).toHaveLength(0);
  });
});
