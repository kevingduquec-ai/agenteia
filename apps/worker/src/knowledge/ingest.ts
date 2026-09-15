import {
  closePool,
  getChunksWithoutEmbeddings,
  listKnowledgeSourcesByTenant,
  replaceKnowledgeChunks,
  upsertKnowledgeDocument,
  upsertKnowledgeEmbedding,
} from '@prefiero-ia/database';
import { loadQwenEmbeddingConfig, QwenEmbeddingProvider } from '@prefiero-ia/llm';
import { parseFrequentQuestionsApi } from './accordion-parser.js';
import { contentHash } from '../crawler/hash.js';
import { politeFetch } from '../crawler/http.js';
import { chunkSection } from './chunk.js';
import { parseKnowledgePage, type KnowledgePage } from './page-parser.js';

export interface IngestOptions {
  tenantId: string;
  delayMs: number;
}

export interface IngestSummary {
  /** Cuantas fuentes tenia configuradas este tenant (0 = nada que ingestar, ver `pnpm run add-knowledge-source`). */
  sourcesConfigured: number;
  pagesProcessed: number;
  documentsChanged: number;
  chunksWritten: number;
  embeddingsWritten: number;
  embeddingsSkippedReason: string | null;
  errors: Array<{ source: string; message: string }>;
}

export async function runKnowledgeIngest(options: IngestOptions): Promise<IngestSummary> {
  const sources = await listKnowledgeSourcesByTenant(options.tenantId);
  const summary: IngestSummary = {
    sourcesConfigured: sources.length,
    pagesProcessed: 0,
    documentsChanged: 0,
    chunksWritten: 0,
    embeddingsWritten: 0,
    embeddingsSkippedReason: null,
    errors: [],
  };

  for (const source of sources) {
    const sourceUrl = source.sourceUrl ?? source.url;
    try {
      const body = await politeFetch(source.url, options.delayMs, source.headers ?? undefined);
      const page: KnowledgePage = source.kind === 'frequent-questions-api' ? parseFrequentQuestionsApi(body) : parseKnowledgePage(body);

      if (page.sections.length === 0) {
        summary.errors.push({ source: sourceUrl, message: 'No se encontraron secciones de contenido en la pagina.' });
        continue;
      }

      const docHash = contentHash([page.title, ...page.sections.map((s) => `${s.heading}::${s.text}`)]);
      const docResult = await upsertKnowledgeDocument(options.tenantId, { sourceUrl, title: page.title, contentHash: docHash });
      summary.pagesProcessed += 1;

      if (docResult.changed) {
        summary.documentsChanged += 1;
        const chunks = page.sections.flatMap((section) => chunkSection(section.heading, section.text));
        const chunkInputs = chunks.map((chunk) => ({
          section: chunk.section,
          content: chunk.content,
          contentHash: contentHash([chunk.content]),
        }));
        await replaceKnowledgeChunks(docResult.id, chunkInputs);
        summary.chunksWritten += chunkInputs.length;
      }
    } catch (error) {
      summary.errors.push({ source: sourceUrl, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const embeddingProvider = new QwenEmbeddingProvider(loadQwenEmbeddingConfig());
  if (!embeddingProvider.isConfigured()) {
    summary.embeddingsSkippedReason = 'QWEN_API_KEY no configurada — los chunks quedaron sin embedding (busqueda de texto completo sigue funcionando).';
  } else {
    const pending = await getChunksWithoutEmbeddings(options.tenantId, 1000);
    for (const chunk of pending) {
      try {
        const result = await embeddingProvider.embed(chunk.content);
        await upsertKnowledgeEmbedding(chunk.id, result.embedding, result.model);
        summary.embeddingsWritten += 1;
      } catch (error) {
        summary.errors.push({
          source: `chunk:${chunk.id}`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  await closePool();
  return summary;
}
