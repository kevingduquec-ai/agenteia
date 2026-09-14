import { Injectable, Logger } from '@nestjs/common';
import { loadQwenEmbeddingConfig, QwenEmbeddingProvider } from '@prefiero-ia/llm';
import { searchKnowledge, type KnowledgeMatch } from '@prefiero-ia/rag';

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly embeddingProvider = new QwenEmbeddingProvider(loadQwenEmbeddingConfig());

  async search(query: string, limit = 5): Promise<KnowledgeMatch[]> {
    const embed = this.embeddingProvider.isConfigured()
      ? async (text: string) => (await this.embeddingProvider.embed(text)).embedding
      : undefined;

    if (!embed) {
      this.logger.debug('QWEN_API_KEY no configurada: busqueda de conocimiento solo por texto completo.');
    }

    return searchKnowledge(query, { limit, embed });
  }
}
