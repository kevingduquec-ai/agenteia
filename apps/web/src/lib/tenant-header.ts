/**
 * `apps/web` es UN solo despliegue que sirve a todos los clientes,
 * distinguidos por el subdominio con el que el navegador esta viendo el
 * widget/panel (ej. "acr.app.tu-dominio.com") — nunca por el dominio de
 * la API en si, que es distinto en producción. Este header le dice a la
 * API cual es ese subdominio para que resuelva a que tenant pertenece
 * cada peticion (ver `apps/api/src/tenant/tenant.middleware.ts`).
 */
export function tenantHeaders(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }
  return { 'X-Tenant-Host': window.location.hostname };
}
