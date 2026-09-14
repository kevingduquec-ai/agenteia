import { loadDeepSeekConfig, loadGatewayConfig, loadQwenConfig } from './config.js';
import { LLMNotConfiguredError } from './errors.js';
import { DeepSeekProvider } from './providers/deepseek.provider.js';
import { QwenProvider } from './providers/qwen.provider.js';
import type {
  GenerateOptions,
  GenerateResult,
  HealthCheckResult,
  LLMProvider,
  LLMProviderName,
  StreamChunk,
  ToolDefinition,
  UsageEvent,
} from './types.js';

export interface LLMGatewayOptions {
  providers: Record<LLMProviderName, LLMProvider>;
  primary: LLMProviderName;
  fallback: LLMProviderName;
  onUsage?: (usage: UsageEvent) => void;
}

/**
 * Punto único por el que la aplicación habla con los proveedores de LLM.
 * Ningún módulo debe importar QwenProvider/DeepSeekProvider directamente:
 * todo pasa por LLMGateway, que decide primario/fallback vía
 * LLM_PRIMARY / LLM_FALLBACK y nunca lanza si un proveedor aún no tiene
 * API key — simplemente reporta "no configurado" en healthCheck().
 */
export class LLMGateway {
  private readonly providers: Record<LLMProviderName, LLMProvider>;
  private readonly primary: LLMProviderName;
  private readonly fallback: LLMProviderName;
  private readonly onUsage?: (usage: UsageEvent) => void;

  constructor(options: LLMGatewayOptions) {
    this.providers = options.providers;
    this.primary = options.primary;
    this.fallback = options.fallback;
    this.onUsage = options.onUsage;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, onUsage?: (usage: UsageEvent) => void): LLMGateway {
    const gatewayConfig = loadGatewayConfig(env);
    return new LLMGateway({
      providers: {
        qwen: new QwenProvider(loadQwenConfig(env)),
        deepseek: new DeepSeekProvider(loadDeepSeekConfig(env)),
      },
      primary: gatewayConfig.primary,
      fallback: gatewayConfig.fallback,
      onUsage,
    });
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    return this.runWithFallback((provider) => provider.generate(options));
  }

  async callTools(options: GenerateOptions & { tools: ToolDefinition[] }): Promise<GenerateResult> {
    return this.runWithFallback((provider) => provider.callTools(options));
  }

  /**
   * Igual que generate()/callTools(), intenta el primario y cae al
   * fallback si falla — pero solo si el fallo ocurre ANTES de emitir el
   * primer chunk. Una vez que el streaming ya empezo a mandar texto real
   * al usuario, reintentar con otro proveedor produciria una respuesta
   * duplicada/mezclada, asi que ahi simplemente se deja propagar el error.
   */
  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk, void, void> {
    const primaryProvider = this.providers[this.primary];
    const fallbackProvider = this.providers[this.fallback];
    const canFallback = fallbackProvider.isConfigured() && fallbackProvider !== primaryProvider;

    if (primaryProvider.isConfigured()) {
      const iterator = primaryProvider.stream(options);
      let first: IteratorResult<StreamChunk, GenerateResult>;
      try {
        first = await iterator.next();
      } catch (error) {
        if (!canFallback) {
          throw error;
        }
        yield* fallbackProvider.stream(options);
        return;
      }
      if (!first.done) {
        yield first.value;
        yield* iterator;
      }
      return;
    }

    if (fallbackProvider.isConfigured()) {
      yield* fallbackProvider.stream(options);
      return;
    }

    throw new LLMNotConfiguredError(this.primary);
  }

  async healthCheck(): Promise<HealthCheckResult[]> {
    return Promise.all(Object.values(this.providers).map((provider) => provider.healthCheck()));
  }

  private async runWithFallback(
    run: (provider: LLMProvider) => Promise<GenerateResult>,
  ): Promise<GenerateResult> {
    const primaryProvider = this.providers[this.primary];
    const fallbackProvider = this.providers[this.fallback];

    if (primaryProvider.isConfigured()) {
      try {
        const result = await run(primaryProvider);
        this.reportUsage(result);
        return result;
      } catch (error) {
        if (!fallbackProvider.isConfigured() || fallbackProvider === primaryProvider) {
          throw error;
        }
        // El primario falló (timeout, error de proveedor) — reintentamos con el fallback.
      }
    }

    if (fallbackProvider.isConfigured()) {
      const result = await run(fallbackProvider);
      this.reportUsage(result);
      return result;
    }

    throw new LLMNotConfiguredError(this.primary);
  }

  private reportUsage(result: GenerateResult): void {
    this.onUsage?.({
      provider: result.provider,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
  }
}
