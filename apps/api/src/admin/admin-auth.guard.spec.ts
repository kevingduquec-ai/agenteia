import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ADMIN_COOKIE_NAME, AdminAuthGuard, AdminOnlyGuard, OwnerOnlyGuard } from './admin-auth.guard.js';
import type { AdminAuthService, AdminTokenPayload } from './admin-auth.service.js';

function contextWith(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function fakeAuthService(verifyToken: (token: string) => AdminTokenPayload | null): AdminAuthService {
  return { verifyToken } as unknown as AdminAuthService;
}

describe('AdminAuthGuard', () => {
  it('rechaza sin cookie de sesion', () => {
    const guard = new AdminAuthGuard(fakeAuthService(() => null));
    expect(() => guard.canActivate(contextWith({ cookies: {} }))).toThrow(UnauthorizedException);
  });

  it('rechaza un token invalido/expirado', () => {
    const guard = new AdminAuthGuard(fakeAuthService(() => null));
    const context = contextWith({ cookies: { [ADMIN_COOKIE_NAME]: 'token-invalido' } });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('SEGURIDAD: rechaza un token valido si su tenantId no coincide con el tenant resuelto para esta peticion (evita reusar una sesion de un cliente en el subdominio de otro)', () => {
    const payload: AdminTokenPayload = { sub: 'admin', role: 'admin', tenantId: 'tenant-A' };
    const guard = new AdminAuthGuard(fakeAuthService(() => payload));
    const request = { cookies: { [ADMIN_COOKIE_NAME]: 'token-valido' }, tenant: { id: 'tenant-B' } };

    expect(() => guard.canActivate(contextWith(request))).toThrow(UnauthorizedException);
  });

  it('acepta un token valido cuyo tenantId SI coincide con el tenant resuelto, y deja al usuario en request.adminUser', () => {
    const payload: AdminTokenPayload = { sub: 'admin', role: 'admin', tenantId: 'tenant-A' };
    const guard = new AdminAuthGuard(fakeAuthService(() => payload));
    const request: Record<string, unknown> = { cookies: { [ADMIN_COOKIE_NAME]: 'token-valido' }, tenant: { id: 'tenant-A' } };

    expect(guard.canActivate(contextWith(request))).toBe(true);
    expect(request.adminUser).toEqual(payload);
  });
});

describe('AdminOnlyGuard', () => {
  it('permite "admin" y "owner", rechaza "soporte"', () => {
    const guard = new AdminOnlyGuard();
    expect(guard.canActivate(contextWith({ adminUser: { role: 'admin' } }))).toBe(true);
    expect(guard.canActivate(contextWith({ adminUser: { role: 'owner' } }))).toBe(true);
    expect(() => guard.canActivate(contextWith({ adminUser: { role: 'soporte' } }))).toThrow(ForbiddenException);
  });
});

describe('OwnerOnlyGuard', () => {
  it('solo permite "owner"', () => {
    const guard = new OwnerOnlyGuard();
    expect(guard.canActivate(contextWith({ adminUser: { role: 'owner' } }))).toBe(true);
    expect(() => guard.canActivate(contextWith({ adminUser: { role: 'admin' } }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextWith({ adminUser: { role: 'soporte' } }))).toThrow(ForbiddenException);
  });
});
