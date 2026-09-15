import { BadRequestException, Injectable, type NestMiddleware } from '@nestjs/common';
import { findTenantByHost, findTenantBySlug, listTenants, type TenantRow } from '@prefiero-ia/database';
import type { NextFunction, Request, Response } from 'express';

declare module 'express' {
  interface Request {
    tenant?: TenantRow;
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Resuelve a que tenant (cliente/marketplace) pertenece cada peticion —
 * el mecanismo central de la arquitectura multi-tenant. `apps/web` es UN
 * solo despliegue para todos los clientes, asi que manda el host con el
 * que el navegador esta viendo el widget/panel en el header
 * `X-Tenant-Host` (`window.location.hostname` del lado del navegador) —
 * nunca se resuelve por el Host de la propia peticion a la API, porque
 * `apps/web` y `apps/api` viven en dominios DISTINTOS en produccion (ver
 * docs/DEPLOYMENT.md): el Host que la API ve es el suyo propio
 * (ej. "api.tu-dominio.com"), no el del tenant.
 *
 * Para desarrollo local (sin subdominios reales) hay un fallback: si no
 * llega el header, o llega "localhost"/"127.0.0.1" a secas, se usa
 * `DEFAULT_TENANT_SLUG` del `.env` — o, si en la base solo existe un
 * tenant, ese unico tenant — para no romper el flujo de desarrollo que ya
 * existia antes de esta arquitectura.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const tenantHost = normalizeHost(req.header('x-tenant-host'));

    let tenant: TenantRow | null = null;
    if (tenantHost && !LOCAL_HOSTS.has(tenantHost)) {
      tenant = await findTenantByHost(tenantHost);
    }

    if (!tenant) {
      tenant = await resolveDevFallbackTenant();
    }

    if (!tenant) {
      throw new BadRequestException(
        'No se pudo determinar a que cliente (tenant) pertenece esta peticion. Revisa el header X-Tenant-Host, o fija DEFAULT_TENANT_SLUG en .env para desarrollo local.',
      );
    }

    req.tenant = tenant;
    next();
  }
}

function normalizeHost(host: string | undefined): string | null {
  if (!host) return null;
  return host.split(':')[0].trim().toLowerCase() || null;
}

async function resolveDevFallbackTenant(): Promise<TenantRow | null> {
  const fallbackSlug = process.env.DEFAULT_TENANT_SLUG;
  if (fallbackSlug) {
    return findTenantBySlug(fallbackSlug);
  }
  const all = await listTenants();
  return all.length === 1 ? all[0] : null;
}
