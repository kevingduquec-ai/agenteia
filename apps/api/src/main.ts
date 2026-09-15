import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { listTenants } from '@prefiero-ia/database';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../');
loadEnv({ path: path.join(repoRoot, '.env') });

// Con multi-tenant, los origenes permitidos ya no son una sola lista fija
// (`CORS_ORIGINS`): cada tenant tiene su propio dominio de `apps/web`
// (`tenants.host`) y su propio sitio real donde se embebe el widget
// (`tenants.extra_cors_origins`) — se recalculan desde la base, con un
// cache corto para no consultarla en cada request. `CORS_ORIGINS` sigue
// aceptandose como una lista extra global (comodo para herramientas
// internas que no son "un tenant").
const ORIGINS_CACHE_TTL_MS = 60_000;
let originsCache: { list: string[]; expiresAt: number } | null = null;

async function getAllowedOrigins(): Promise<string[]> {
  if (originsCache && originsCache.expiresAt > Date.now()) {
    return originsCache.list;
  }
  const tenants = await listTenants();
  const fromTenants = tenants.flatMap((tenant) => {
    // https siempre; http tambien para "*.localhost" en desarrollo, que
    // nunca se sirve con TLS.
    const hostOrigins = [`https://${tenant.host}`, `http://${tenant.host}`];
    const extra = tenant.extraCorsOrigins?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];
    return [...hostOrigins, ...extra];
  });
  const staticExtra = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];
  const list = [...new Set([...fromTenants, ...staticExtra])];
  originsCache = { list, expiresAt: Date.now() + ORIGINS_CACHE_TTL_MS };
  return list;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // El chat se sirve dentro de un <iframe> embebido en el sitio del
  // marketplace (ver apps/web/public/embed.js) — no necesita heredar las
  // cabeceras de seguridad pensadas para paginas HTML servidas directo.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  // El panel /admin usa una cookie de sesion httpOnly — sin cookie-parser
  // el guard nunca puede leerla de la request.
  app.use(cookieParser());

  // En desarrollo se acepta cualquier origen — mismo comportamiento de
  // siempre (`localhost:3000` sin subdominio real de tenant, distintos
  // puertos al probar cosas sueltas). La validacion estricta por tenant
  // solo tiene sentido, y solo se activa, en produccion.
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    Logger.warn('NODE_ENV != production: CORS acepta cualquier origen. Esto se endurece solo en producción.', 'Bootstrap');
  }

  // credentials:true es necesario para que la cookie de sesion del panel
  // /admin viaje entre apps/web y apps/api — sin esto el navegador
  // descarta la cookie en cualquier request cross-origin.
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!isProduction || !origin) {
        // Sin header Origin: request server-to-server o same-origin — nunca viene de un navegador de tercero.
        callback(null, true);
        return;
      }
      getAllowedOrigins()
        .then((allowed) => {
          if (allowed.includes(origin)) {
            callback(null, true);
          } else {
            Logger.warn(`CORS: origen rechazado "${origin}" (no coincide con ningun tenant ni CORS_ORIGINS).`, 'Bootstrap');
            callback(null, false);
          }
        })
        .catch((error) => callback(error, false));
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // descarta cualquier campo del body que no este declarado en el DTO
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.API_PORT ?? 3001);
}
await bootstrap();
