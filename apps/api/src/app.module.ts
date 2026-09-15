import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LlmModule } from './llm/llm.module.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { ChatModule } from './chat/chat.module.js';
import { AdminModule } from './admin/admin.module.js';
import { TenantMiddleware } from './tenant/tenant.middleware.js';

@Module({
  imports: [
    // Limite generoso por defecto (protege contra scraping/abuso masivo);
    // el chat, mas costoso por token, tiene su propio limite mas estricto
    // via @Throttle en ChatController.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    LlmModule,
    KnowledgeModule,
    ChatModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  // Global: toda ruta necesita saber a que tenant pertenece antes de tocar
  // cualquier dato (catalogo, conversaciones, cuentas admin) — mas seguro
  // que aplicarlo ruta por ruta y arriesgar olvidar una.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
