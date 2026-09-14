# @prefiero-ia/llm

Gateway único hacia los proveedores de LLM (Qwen / DeepSeek). Ningún otro
módulo debe importar un proveedor concreto directamente — todo pasa por
`LLMGateway`, que nunca lanza si un proveedor no tiene API key: reporta
"no configurado" y sigue con el siguiente.

## Piezas principales

- **`gateway.ts`** (`LLMGateway`) — punto de entrada. `LLM_PRIMARY` /
  `LLM_FALLBACK` (en `.env`) deciden qué proveedor se intenta primero;
  si el primario falla o no está configurado, reintenta automáticamente
  con el de respaldo. Expone `generate`, `stream`, `callTools` y
  `healthCheck`.
- **`config.ts`** — lee `.env` y arma la config de cada proveedor.
  `loadQwenEmbeddingConfig()` tiene su propio par key/URL porque
  DashScope/QwenCloud factura los embeddings **siempre** pay-as-you-go,
  nunca por Token Plan (mezclar una key de un sistema con la URL del otro
  da 401/403 aunque el plan esté pago — ver comentario en `.env.example`).
- **`providers/`** — implementación real sobre el SDK de OpenAI, ya que
  tanto Qwen (DashScope compatible-mode) como DeepSeek exponen una API
  compatible con Chat Completions:
  - `openai-compatible.provider.ts` — la lógica compartida (streaming,
    tool calls, mapeo de errores).
  - `qwen.provider.ts` / `deepseek.provider.ts` — configuración específica
    de cada uno sobre esa base compartida.
  - `openai-mapping.ts` — traduce entre los tipos propios (`ChatMessage`,
    `ToolDefinition`) y el formato que espera el SDK de OpenAI.
- **`embeddings/`** — `QwenEmbeddingProvider`, separado del gateway de
  chat porque los embeddings no son "generar texto" (interfaz distinta,
  facturación distinta).
- **`errors.ts`** — `LLMNotConfiguredError`, el único tipo de error que
  el resto del sistema necesita distinguir explícitamente (para mostrar
  "el modelo no está conectado" en vez de un error genérico).

## Cómo se usa

`@prefiero-ia/agent-core` construye el `LLMGateway` con las dos claves del
`.env` y se lo pasa al `AgentEngine`. `GET /llm/health` (en `apps/api`)
expone `healthCheck()` directamente para diagnóstico.
