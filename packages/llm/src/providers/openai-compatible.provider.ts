import OpenAI from 'openai';
import type { ProviderEnvConfig } from '../config.js';
import { LLMNotConfiguredError } from '../errors.js';
import type {
  GenerateOptions,
  GenerateResult,
  HealthCheckResult,
  LLMProvider,
  LLMProviderName,
  StreamChunk,
} from '../types.js';
import { fromOpenAIResponse, toOpenAIMessages, toOpenAITools } from './openai-mapping.js';

/**
 * Qwen (DashScope compatible-mode) y DeepSeek exponen ambos una API
 * compatible con OpenAI Chat Completions, así que un solo cliente basta
 * para los dos proveedores — solo cambian baseURL / apiKey / modelo.
 */
export abstract class OpenAICompatibleProvider implements LLMProvider {
  abstract readonly name: LLMProviderName;
  readonly model: string;
  private readonly client: OpenAI | null;

  constructor(config: ProviderEnvConfig) {
    this.model = config.model;
    this.client = config.apiKey ? new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  private requireClient(): OpenAI {
    if (!this.client) {
      throw new LLMNotConfiguredError(this.name);
    }
    return this.client;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const client = this.requireClient();
    const response = await client.chat.completions.create({
      model: this.model,
      messages: toOpenAIMessages(options.messages),
      tools: options.tools ? toOpenAITools(options.tools) : undefined,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens,
    });
    return fromOpenAIResponse(response, this.name, this.model);
  }

  async callTools(options: GenerateOptions & { tools: import('../types.js').ToolDefinition[] }): Promise<GenerateResult> {
    return this.generate(options);
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk, GenerateResult, void> {
    const client = this.requireClient();
    const stream = await client.chat.completions.create({
      model: this.model,
      messages: toOpenAIMessages(options.messages),
      tools: options.tools ? toOpenAITools(options.tools) : undefined,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens,
      stream: true,
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        fullContent += delta;
        yield { delta, done: false };
      }
    }
    yield { delta: '', done: true };

    return {
      content: fullContent,
      toolCalls: [],
      finishReason: 'stop',
      provider: this.name,
      model: this.model,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.isConfigured()) {
      return {
        provider: this.name,
        configured: false,
        ok: false,
        model: this.model,
        message: `Falta la API key de ${this.name} (ver .env.example).`,
      };
    }

    try {
      await this.generate({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 });
      return { provider: this.name, configured: true, ok: true, model: this.model };
    } catch (error) {
      return {
        provider: this.name,
        configured: true,
        ok: false,
        model: this.model,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
