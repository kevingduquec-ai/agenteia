import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthService, type AdminTokenPayload } from './admin-auth.service.js';

export const ADMIN_COOKIE_NAME = 'prefiero_admin_session';

declare module 'express' {
  interface Request {
    adminUser?: AdminTokenPayload;
  }
}

/**
 * Cualquier cuenta valida (admin o soporte) — deja al usuario autenticado
 * en `request.adminUser` para que otros guards/controllers sepan el rol.
 * Ademas exige que el tenant del token coincida con el tenant que
 * `TenantMiddleware` resolvio para ESTA peticion — sin esto, una sesion
 * iniciada en el subdominio de un cliente seguiria siendo valida si se
 * reusa (robada, o una pestaña vieja) contra el subdominio de otro
 * cliente distinto.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly authService: AdminAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token: string | undefined = request.cookies?.[ADMIN_COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedException('No autenticado.');
    }
    const payload = this.authService.verifyToken(token);
    if (!payload) {
      throw new UnauthorizedException('Sesion invalida o expirada.');
    }
    if (payload.tenantId !== request.tenant?.id) {
      throw new UnauthorizedException('Sesion invalida para este cliente.');
    }
    request.adminUser = payload;
    return true;
  }
}

/**
 * Requiere rol "admin" u "owner" — protege dashboards/analitica (el owner
 * tiene todos los privilegios de admin, ademas de la gestion de usuarios).
 * Se usa SIEMPRE despues de `AdminAuthGuard` en el mismo `@UseGuards(...)`
 * (el orden del array importa: NestJS los corre en secuencia y este asume
 * que `request.adminUser` ya quedo seteado). El rol "soporte" pedido por
 * el usuario NUNCA debe poder ver esto.
 */
@Injectable()
export class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const role = request.adminUser?.role;
    if (role !== 'admin' && role !== 'owner') {
      throw new ForbiddenException('Esta sección es solo para administradores.');
    }
    return true;
  }
}

/**
 * Requiere estrictamente rol "owner" — protege la gestion de cuentas
 * admin/soporte (`AdminUsersController`). Ni "admin" ni "soporte" pueden
 * crear/borrar cuentas de otros, solo el owner (pedido explicito del
 * usuario: "un solo rol que sea el owner" quien crea al resto).
 */
@Injectable()
export class OwnerOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.adminUser?.role !== 'owner') {
      throw new ForbiddenException('Esta sección es solo para el propietario de la cuenta.');
    }
    return true;
  }
}
