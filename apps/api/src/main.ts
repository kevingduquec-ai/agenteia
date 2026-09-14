import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../');
loadEnv({ path: path.join(repoRoot, '.env') });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // El chat se sirve dentro de un <iframe> embebido en el sitio del
  // marketplace (ver apps/web/public/embed.js) — no necesita heredar las
  // cabeceras de seguridad pensadas para paginas HTML servidas directo.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  // El panel /admin usa una cookie de sesion httpOnly — sin cookie-parser
  // el guard nunca puede leerla de la request.
  app.use(cookieParser());

  const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!allowedOrigins?.length) {
    Logger.warn(
      'CORS_ORIGINS no esta configurada: se acepta cualquier origen. Antes de producción, fija los dominios reales (ej. https://app.prefiero-ia.com) en .env.',
      'Bootstrap',
    );
  }
  // credentials:true es necesario para que la cookie de sesion del panel
  // /admin viaje entre apps/web (3000) y apps/api (3001) — sin esto el
  // navegador descarta la cookie en cualquier request cross-origin.
  app.enableCors({ origin: allowedOrigins?.length ? allowedOrigins : true, credentials: true });

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
