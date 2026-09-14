import { loadDeepSeekConfig, type ProviderEnvConfig } from '../config.js';
import type { LLMProviderName } from '../types.js';
import { OpenAICompatibleProvider } from './openai-compatible.provider.js';

export class DeepSeekProvider extends OpenAICompatibleProvider {
  readonly name: LLMProviderName = 'deepseek';

  constructor(config: ProviderEnvConfig = loadDeepSeekConfig()) {
    super(config);
  }
}
