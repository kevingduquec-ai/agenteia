import { createParamDecorator, InternalServerErrorException, type ExecutionContext } from '@nestjs/common';
import type { TenantRow } from '@prefiero-ia/database';
import type { Request } from 'express';

/**
 * Trae el tenant que `TenantMiddleware` ya resolvio para esta peticion.
 * Lanza si se usa en una ruta que no pasa por el middleware (nunca deberia
 * pasar — el middleware esta registrado globalmente en AppModule — pero
 * es mejor un error explicito que un `undefined` silencioso filtrandose
 * hasta una query SQL).
 */
export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantRow => {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (!request.tenant) {
    throw new InternalServerErrorException('TenantMiddleware no corrio para esta ruta — falta registrarla en AppModule.');
  }
  return request.tenant;
});
