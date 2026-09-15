import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantRow } from '@prefiero-ia/database';

const { findTenantByHostMock, findTenantBySlugMock, listTenantsMock } = vi.hoisted(() => ({
  findTenantByHostMock: vi.fn(),
  findTenantBySlugMock: vi.fn(),
  listTenantsMock: vi.fn(),
}));

vi.mock('@prefiero-ia/database', () => ({
  findTenantByHost: findTenantByHostMock,
  findTenantBySlug: findTenantBySlugMock,
  listTenants: listTenantsMock,
}));

const { TenantMiddleware } = await import('./tenant.middleware.js');

function tenant(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: 'tenant-1',
    slug: 'acr',
    name: 'ACR',
    host: 'acr.app.tu-dominio.com',
    crawlerBaseUrl: 'https://prefieroacr.com',
    extraCorsOrigins: null,
    maxAdminSeats: 1,
    maxSupportSeats: 1,
    isActive: true,
    ...overrides,
  };
}

function fakeRequest(headers: Record<string, string> = {}): { header: (name: string) => string | undefined; tenant?: TenantRow } {
  return { header: (name: string) => headers[name.toLowerCase()] };
}

const originalEnv = process.env.DEFAULT_TENANT_SLUG;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env.DEFAULT_TENANT_SLUG = originalEnv;
});

describe('TenantMiddleware', () => {
  it('resuelve el tenant por el header X-Tenant-Host (nunca por el Host de la propia API)', async () => {
    findTenantByHostMock.mockResolvedValueOnce(tenant());
    const req = fakeRequest({ 'x-tenant-host': 'acr.app.tu-dominio.com' });
    const next = vi.fn();

    await new TenantMiddleware().use(req as never, {} as never, next);

    expect(findTenantByHostMock).toHaveBeenCalledWith('acr.app.tu-dominio.com');
    expect(req.tenant?.slug).toBe('acr');
    expect(next).toHaveBeenCalled();
  });

  it('ignora el puerto del header al resolver el host', async () => {
    findTenantByHostMock.mockResolvedValueOnce(tenant());
    const req = fakeRequest({ 'x-tenant-host': 'acr.app.tu-dominio.com:3000' });
    await new TenantMiddleware().use(req as never, {} as never, vi.fn());

    expect(findTenantByHostMock).toHaveBeenCalledWith('acr.app.tu-dominio.com');
  });

  it('"localhost" a secas (sin subdominio real) NO intenta resolver por host — usa el fallback de desarrollo', async () => {
    process.env.DEFAULT_TENANT_SLUG = 'prefiero-acr';
    findTenantBySlugMock.mockResolvedValueOnce(tenant({ slug: 'prefiero-acr' }));
    const req = fakeRequest({ 'x-tenant-host': 'localhost' });

    await new TenantMiddleware().use(req as never, {} as never, vi.fn());

    expect(findTenantByHostMock).not.toHaveBeenCalled();
    expect(findTenantBySlugMock).toHaveBeenCalledWith('prefiero-acr');
    expect(req.tenant?.slug).toBe('prefiero-acr');
  });

  it('sin header en absoluto, cae directo al fallback de desarrollo (DEFAULT_TENANT_SLUG)', async () => {
    process.env.DEFAULT_TENANT_SLUG = 'prefiero-acr';
    findTenantBySlugMock.mockResolvedValueOnce(tenant({ slug: 'prefiero-acr' }));
    await new TenantMiddleware().use(fakeRequest() as never, {} as never, vi.fn());

    expect(findTenantBySlugMock).toHaveBeenCalledWith('prefiero-acr');
  });

  it('sin DEFAULT_TENANT_SLUG, usa el unico tenant existente en la base', async () => {
    delete process.env.DEFAULT_TENANT_SLUG;
    listTenantsMock.mockResolvedValueOnce([tenant()]);
    const req = fakeRequest();

    await new TenantMiddleware().use(req as never, {} as never, vi.fn());

    expect(req.tenant?.id).toBe('tenant-1');
  });

  it('sin DEFAULT_TENANT_SLUG y con mas de un tenant en la base, no puede adivinar — lanza BadRequestException', async () => {
    delete process.env.DEFAULT_TENANT_SLUG;
    listTenantsMock.mockResolvedValueOnce([tenant({ id: 't1' }), tenant({ id: 't2' })]);

    await expect(new TenantMiddleware().use(fakeRequest() as never, {} as never, vi.fn())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un host real que no coincide con ningun tenant, y sin fallback disponible, lanza BadRequestException', async () => {
    delete process.env.DEFAULT_TENANT_SLUG;
    findTenantByHostMock.mockResolvedValueOnce(null);
    listTenantsMock.mockResolvedValueOnce([tenant({ id: 't1' }), tenant({ id: 't2' })]);
    const req = fakeRequest({ 'x-tenant-host': 'sitio-que-no-existe.com' });

    await expect(new TenantMiddleware().use(req as never, {} as never, vi.fn())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un host real que no matchea NUNCA cae al fallback de desarrollo silenciosamente si hay un solo tenant (podria confundir cliente equivocado) — se verifica que SI intenta el fallback, pero solo por diseño explicito, no que nunca lo use', async () => {
    // Nota de diseño (ver tenant.middleware.ts): un host desconocido SI cae
    // al fallback de un-solo-tenant si aplica — es una decision consciente
    // para no romper flujos de desarrollo con subdominios mal configurados.
    // Este test documenta ese comportamiento real en vez de asumir uno.
    delete process.env.DEFAULT_TENANT_SLUG;
    findTenantByHostMock.mockResolvedValueOnce(null);
    listTenantsMock.mockResolvedValueOnce([tenant()]);
    const req = fakeRequest({ 'x-tenant-host': 'host-desconocido.com' });

    await new TenantMiddleware().use(req as never, {} as never, vi.fn());
    expect(req.tenant?.id).toBe('tenant-1');
  });
});
