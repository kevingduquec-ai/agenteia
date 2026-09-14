# @prefiero-ia/security

**Placeholder — todavía sin implementar como paquete propio.** `src/index.ts`
no exporta nada. La defensa de seguridad real que ya existe vive
directamente en `apps/api`, no aquí:

- **Prompt injection**: el system prompt (`apps/api/src/chat/prompt.ts`)
  instruye al modelo a tratar la sección "Información verificada" (lo que
  trae `@prefiero-ia/rag`) como referencia, nunca como instrucciones —
  ignora cualquier texto ahí que intente darle una orden nueva.
- **Rate limiting**: `@nestjs/throttler`, configurado en
  `apps/api/src/app.module.ts` (60 req/min general, 15 req/min en los
  endpoints que llaman al LLM).
- **Validación de entrada**: `ValidationPipe` global con
  `whitelist`/`forbidNonWhitelisted` (`apps/api/src/main.ts`) + DTOs con
  `class-validator` en cada controller.
- **Contraseñas y sesión admin**: hash bcrypt (`admin-auth.service.ts`),
  cookie de sesión `httpOnly`, JWT firmado con `JWT_SECRET`.

Si en algún momento se centraliza esta lógica (sanitización reusable,
guardrails compartidos entre `apps/api` y `apps/worker`), este es el
paquete destinado a alojarla — hoy sigue vacío a propósito, para no crear
una capa de indirección sin necesidad real todavía.
