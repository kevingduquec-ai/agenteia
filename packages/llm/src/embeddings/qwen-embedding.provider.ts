import OpenAI from 'openai';
import { loadQwenEmbeddingConfig, type ProviderEnvConfig } from '../config.js';
import { LLMNotConfiguredError } from '../errors.js';
import type { EmbeddingProvider, EmbeddingResult } from './types.js';

export class QwenEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private readonly client: OpenAI | null;

  constructor(config: ProviderEnvConfig = loadQwenEmbeddingConfig()) {
    this.model = config.model;
    this.client = config.apiKey ? new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const [result] = await this.embedBatch([text]);
    return result;
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.client) {
      throw new LLMNotConfiguredError('qwen-embedding');
    }
    const response = await this.client.embeddings.create({ model: this.model, input: texts });
    return response.data.map((item) => ({ embedding: item.embedding, model: this.model }));
  }
}
