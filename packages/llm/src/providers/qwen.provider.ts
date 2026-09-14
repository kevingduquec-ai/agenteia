import { loadQwenConfig, type ProviderEnvConfig } from '../config.js';
import type { LLMProviderName } from '../types.js';
import { OpenAICompatibleProvider } from './openai-compatible.provider.js';

export class QwenProvider extends OpenAICompatibleProvider {
  readonly name: LLMProviderName = 'qwen';

  constructor(config: ProviderEnvConfig = loadQwenConfig()) {
    super(config);
  }
}
