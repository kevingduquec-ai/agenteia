import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeSearchRow } from '@prefiero-ia/database';

const { searchKnowledgeByVector, searchKnowledgeByFullText } = vi.hoisted(() => ({
  searchKnowledgeByVector: vi.fn<(tenantId: string, vectorLiteral: string, limit: number) => Promise<KnowledgeSearchRow[]>>(),
  searchKnowledgeByFullText: vi.fn<(tenantId: string, query: string, limit: number) => Promise<KnowledgeSearchRow[]>>(),
}));

vi.mock('@prefiero-ia/database', () => ({ searchKnowledgeByVector, searchKnowledgeByFullText }));

import { searchKnowledge } from './search.js';

function row(overrides: Partial<KnowledgeSearchRow> = {}): KnowledgeSearchRow {
  return {
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    documentTitle: 'FAQ',
    sourceUrl: 'https://cliente.com/faq',
    section: null,
    content: 'contenido',
    score: 1,
    ...overrides,
  };
}

afterEach(() => {
  searchKnowledgeByVector.mockReset();
  searchKnowledgeByFullText.mockReset();
});

describe('searchKnowledge', () => {
  it('sin `embed`, nunca llama a la busqueda vectorial — solo usa texto completo', async () => {
    searchKnowledgeByFullText.mockResolvedValue([row({ chunkId: 'a' })]);

    const results = await searchKnowledge('tenant-1', 'como pago', {});
    expect(searchKnowledgeByVector).not.toHaveBeenCalled();
    expect(results).toEqual([{ ...row({ chunkId: 'a' }), matchType: 'fulltext' }]);
  });

  it('filtra matches vectoriales por debajo de MIN_VECTOR_SCORE (0.55) — un score suave no cuenta como relevante', async () => {
    searchKnowledgeByVector.mockResolvedValue([row({ chunkId: 'debil', score: 0.4 }), row({ chunkId: 'fuerte', score: 0.8 })]);
    searchKnowledgeByFullText.mockResolvedValue([]);

    const results = await searchKnowledge('tenant-1', 'algo', { embed: async () => [1, 0, 0] });
    expect(results.map((r) => r.chunkId)).toEqual(['fuerte']);
  });

  it('deduplica por chunkId — un chunk que aparece en ambas busquedas queda una sola vez, marcado como "vector"', async () => {
    searchKnowledgeByVector.mockResolvedValue([row({ chunkId: 'compartido', score: 0.9 })]);
    searchKnowledgeByFullText.mockResolvedValue([row({ chunkId: 'compartido', score: 5 }), row({ chunkId: 'solo-fulltext', score: 2 })]);

    const results = await searchKnowledge('tenant-1', 'algo', { embed: async () => [1, 0, 0] });
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.chunkId === 'compartido')?.matchType).toBe('vector');
  });

  it('si el embedding falla, sigue funcionando solo con texto completo (no propaga el error)', async () => {
    searchKnowledgeByFullText.mockResolvedValue([row({ chunkId: 'a' })]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const results = await searchKnowledge('tenant-1', 'algo', {
      embed: async () => {
        throw new Error('timeout del proveedor de embeddings');
      },
    });

    expect(results).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('nunca devuelve mas resultados que `limit`, incluso combinando ambas fuentes', async () => {
    searchKnowledgeByVector.mockResolvedValue([row({ chunkId: 'v1', score: 0.9 }), row({ chunkId: 'v2', score: 0.9 })]);
    searchKnowledgeByFullText.mockResolvedValue([row({ chunkId: 'f1' }), row({ chunkId: 'f2' })]);

    const results = await searchKnowledge('tenant-1', 'algo', { embed: async () => [1], limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('pasa el tenantId a ambas busquedas subyacentes', async () => {
    searchKnowledgeByVector.mockResolvedValue([]);
    searchKnowledgeByFullText.mockResolvedValue([]);

    await searchKnowledge('tenant-especifico', 'algo', { embed: async () => [1] });
    expect(searchKnowledgeByVector).toHaveBeenCalledWith('tenant-especifico', expect.any(String), expect.any(Number));
    expect(searchKnowledgeByFullText).toHaveBeenCalledWith('tenant-especifico', 'algo', expect.any(Number));
  });
});
