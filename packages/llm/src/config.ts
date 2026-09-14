import type { LLMProviderName } from './types.js';

export interface ProviderEnvConfig {
  apiKey?: string;
  model: string;
  baseUrl: string;
}

export interface GatewayEnvConfig {
  primary: LLMProviderName;
  fallback: LLMProviderName;
}

export function loadQwenConfig(env: NodeJS.ProcessEnv = process.env): ProviderEnvConfig {
  return {
    apiKey: env.QWEN_API_KEY || undefined,
    model: env.QWEN_MODEL || 'qwen3.8-flash',
    baseUrl: env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  };
}

export function loadDeepSeekConfig(env: NodeJS.ProcessEnv = process.env): ProviderEnvConfig {
  return {
    apiKey: env.DEEPSEEK_API_KEY || undefined,
    model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  };
}

/**
 * Los embeddings de Qwen se facturan pay-as-you-go y NUNCA por Token Plan
 * (ese solo cubre el modelo de chat) — por eso usan su propio par
 * key/URL, independiente de QWEN_API_KEY/QWEN_BASE_URL. Si no se
 * configuran explicitamente, caen de vuelta a esas mismas variables (para
 * el caso comun de una cuenta que solo usa pay-as-you-go en todo), pero
 * en cuanto QWEN_BASE_URL apunte a un dominio de Token Plan hay que fijar
 * QWEN_EMBEDDING_API_KEY / QWEN_EMBEDDING_BASE_URL por separado.
 */
export function loadQwenEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): ProviderEnvConfig {
  return {
    apiKey: env.QWEN_EMBEDDING_API_KEY || env.QWEN_API_KEY || undefined,
    model: env.EMBEDDING_MODEL || 'qwen3.7-text-embedding',
    baseUrl: env.QWEN_EMBEDDING_BASE_URL || env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  };
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayEnvConfig {
  return {
    primary: (env.LLM_PRIMARY as LLMProviderName) || 'qwen',
    fallback: (env.LLM_FALLBACK as LLMProviderName) || 'deepseek',
  };
}
