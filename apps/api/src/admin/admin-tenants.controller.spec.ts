import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { addKnowledgeSourceMock, createTenantMock, deleteKnowledgeSourceMock, listKnowledgeSourcesByTenantMock, listTenantsMock } = vi.hoisted(
  () => ({
    addKnowledgeSourceMock: vi.fn(),
    createTenantMock: vi.fn(),
    deleteKnowledgeSourceMock: vi.fn(),
    listKnowledgeSourcesByTenantMock: vi.fn(),
    listTenantsMock: vi.fn(),
  }),
);

vi.mock('@prefiero-ia/database', () => ({
  addKnowledgeSource: addKnowledgeSourceMock,
  createTenant: createTenantMock,
  deleteKnowledgeSource: deleteKnowledgeSourceMock,
  listKnowledgeSourcesByTenant: listKnowledgeSourcesByTenantMock,
  listTenants: listTenantsMock,
}));

const { AdminTenantsController } = await import('./admin-tenants.controller.js');

afterEach(() => {
  vi.clearAllMocks();
});

describe('AdminTenantsController', () => {
  it('list() devuelve TODOS los tenants — deliberadamente global, no acotado al tenant actual', async () => {
    listTenantsMock.mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }]);
    const controller = new AdminTenantsController();
    expect(await controller.list()).toEqual([{ id: 't1' }, { id: 't2' }]);
  });

  it('create() crea el tenant con los campos del DTO y lo envuelve en { ok, tenant }', async () => {
    const created = { id: 't1', slug: 'acr', name: 'ACR' };
    createTenantMock.mockResolvedValueOnce(created);
    const controller = new AdminTenantsController();

    const result = await controller.create({
      slug: 'acr',
      name: 'ACR',
      host: 'acr.app.tu-dominio.com',
      crawlerBaseUrl: 'https://prefieroacr.com',
    });

    expect(createTenantMock).toHaveBeenCalledWith({
      slug: 'acr',
      name: 'ACR',
      host: 'acr.app.tu-dominio.com',
      crawlerBaseUrl: 'https://prefieroacr.com',
      extraCorsOrigins: undefined,
      maxAdminSeats: undefined,
      maxSupportSeats: undefined,
    });
    expect(result).toEqual({ ok: true, tenant: created });
  });

  it('create() traduce una violacion de UNIQUE (slug/host duplicado) a un error claro, no un 500 crudo', async () => {
    createTenantMock.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }));
    const controller = new AdminTenantsController();

    await expect(
      controller.create({ slug: 'acr', name: 'ACR', host: 'acr.app.tu-dominio.com', crawlerBaseUrl: 'https://prefieroacr.com' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create() deja pasar cualquier otro error tal cual (no lo esconde detras de un mensaje generico)', async () => {
    createTenantMock.mockRejectedValueOnce(new Error('fallo de red inesperado'));
    const controller = new AdminTenantsController();

    await expect(
      controller.create({ slug: 'acr', name: 'ACR', host: 'acr.app.tu-dominio.com', crawlerBaseUrl: 'https://prefieroacr.com' }),
    ).rejects.toThrow('fallo de red inesperado');
  });

  it('listSources() delega en listKnowledgeSourcesByTenant con el id de la URL', async () => {
    listKnowledgeSourcesByTenantMock.mockResolvedValueOnce([{ id: 's1' }]);
    const controller = new AdminTenantsController();
    expect(await controller.listSources('tenant-1')).toEqual([{ id: 's1' }]);
    expect(listKnowledgeSourcesByTenantMock).toHaveBeenCalledWith('tenant-1');
  });

  it('addSource() usa "heading" como kind por defecto cuando el body no lo especifica', async () => {
    addKnowledgeSourceMock.mockResolvedValueOnce({ id: 's1', kind: 'heading' });
    const controller = new AdminTenantsController();

    const result = await controller.addSource('tenant-1', { url: 'https://cliente.com/faq' });

    expect(addKnowledgeSourceMock).toHaveBeenCalledWith('tenant-1', {
      url: 'https://cliente.com/faq',
      kind: 'heading',
      sourceUrl: undefined,
      headers: undefined,
    });
    expect(result).toEqual({ ok: true, source: { id: 's1', kind: 'heading' } });
  });

  it('addSource() respeta un kind explicito y sus campos asociados (API de preguntas frecuentes)', async () => {
    addKnowledgeSourceMock.mockResolvedValueOnce({ id: 's1' });
    const controller = new AdminTenantsController();

    await controller.addSource('tenant-1', {
      url: 'https://api.cliente.com/faq',
      kind: 'frequent-questions-api',
      sourceUrl: 'https://cliente.com/contacto',
      headers: { 'Token-Client': 'abc' },
    });

    expect(addKnowledgeSourceMock).toHaveBeenCalledWith('tenant-1', {
      url: 'https://api.cliente.com/faq',
      kind: 'frequent-questions-api',
      sourceUrl: 'https://cliente.com/contacto',
      headers: { 'Token-Client': 'abc' },
    });
  });

  it('removeSource() borra la fuente correcta del tenant correcto', async () => {
    const controller = new AdminTenantsController();
    await controller.removeSource('tenant-1', 'source-1');
    expect(deleteKnowledgeSourceMock).toHaveBeenCalledWith('tenant-1', 'source-1');
  });
});
