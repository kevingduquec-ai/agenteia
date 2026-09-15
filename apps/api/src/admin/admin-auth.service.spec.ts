import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUserCredentials } from '@prefiero-ia/database';

const { findAdminUserByUsernameMock } = vi.hoisted(() => ({ findAdminUserByUsernameMock: vi.fn() }));
vi.mock('@prefiero-ia/database', () => ({ findAdminUserByUsername: findAdminUserByUsernameMock }));

const { AdminAuthService } = await import('./admin-auth.service.js');

const OWNER_PASSWORD = 'clave-owner-real';
const MANAGED_PASSWORD = 'clave-soporte-real';

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OWNER_USERNAME = 'admin';
  process.env.OWNER_PASSWORD_HASH = bcrypt.hashSync(OWNER_PASSWORD, 4);
  process.env.JWT_SECRET = 'test-secret';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('AdminAuthService.validateCredentials', () => {
  it('acepta al owner con su usuario/contraseña reales', async () => {
    const service = new AdminAuthService();
    expect(await service.validateCredentials('tenant-1', 'admin', OWNER_PASSWORD)).toBe('owner');
  });

  it('rechaza al owner con la contraseña equivocada', async () => {
    const service = new AdminAuthService();
    expect(await service.validateCredentials('tenant-1', 'admin', 'contraseña-equivocada')).toBeNull();
  });

  it('rechaza al owner si OWNER_PASSWORD_HASH no esta configurado', async () => {
    delete process.env.OWNER_PASSWORD_HASH;
    const service = new AdminAuthService();
    expect(await service.validateCredentials('tenant-1', 'admin', OWNER_PASSWORD)).toBeNull();
  });

  it('valida una cuenta admin/soporte contra el hash guardado, DENTRO del tenant correcto', async () => {
    const credentials: AdminUserCredentials = {
      id: 'u1',
      username: 'soporte1',
      role: 'soporte',
      createdAt: new Date(),
      passwordHash: bcrypt.hashSync(MANAGED_PASSWORD, 4),
      tenantId: 'tenant-1',
    };
    findAdminUserByUsernameMock.mockResolvedValueOnce(credentials);

    const service = new AdminAuthService();
    const role = await service.validateCredentials('tenant-1', 'soporte1', MANAGED_PASSWORD);
    expect(role).toBe('soporte');
    expect(findAdminUserByUsernameMock).toHaveBeenCalledWith('tenant-1', 'soporte1');
  });

  it('rechaza una cuenta admin/soporte que no existe DENTRO de ese tenant (sin filtrar si el username existe en OTRO tenant)', async () => {
    findAdminUserByUsernameMock.mockResolvedValueOnce(null);
    const service = new AdminAuthService();
    expect(await service.validateCredentials('tenant-1', 'soporte-de-otro-cliente', 'cualquier-cosa')).toBeNull();
  });

  it('rechaza una cuenta admin/soporte con la contraseña equivocada', async () => {
    const credentials: AdminUserCredentials = {
      id: 'u1',
      username: 'soporte1',
      role: 'soporte',
      createdAt: new Date(),
      passwordHash: bcrypt.hashSync(MANAGED_PASSWORD, 4),
      tenantId: 'tenant-1',
    };
    findAdminUserByUsernameMock.mockResolvedValueOnce(credentials);
    const service = new AdminAuthService();
    expect(await service.validateCredentials('tenant-1', 'soporte1', 'clave-equivocada')).toBeNull();
  });
});

describe('AdminAuthService.issueToken / verifyToken', () => {
  it('un token emitido se puede verificar y trae el tenantId con el que se inicio sesion', () => {
    const service = new AdminAuthService();
    const token = service.issueToken('tenant-1', 'admin', 'owner');
    const payload = service.verifyToken(token);
    expect(payload).toMatchObject({ sub: 'admin', role: 'owner', tenantId: 'tenant-1' });
  });

  it('un token firmado con otro secreto (u otro formato) no verifica', () => {
    const service = new AdminAuthService();
    expect(service.verifyToken('no-es-un-jwt-valido')).toBeNull();
  });
});
