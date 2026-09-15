import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '../pool.js';
import { createTestTenant } from '../../test/fixtures.js';
import {
  getChunksWithoutEmbeddings,
  replaceKnowledgeChunks,
  searchKnowledgeByFullText,
  searchKnowledgeByVector,
  upsertKnowledgeDocument,
  upsertKnowledgeEmbedding,
} from './knowledge.repository.js';

afterAll(async () => {
  await closePool();
});

/** `knowledge_embeddings.embedding` es `vector(1024)` (ver database/migrations/0002) — `upsertKnowledgeEmbedding` recibe el array y construye el literal `[...]` internamente. */
function unitVector(dimensions: number, activeIndex: number): number[] {
  const values = new Array(dimensions).fill(0);
  values[activeIndex] = 1;
  return values;
}

describe('knowledge.repository', () => {
  it('upsertKnowledgeDocument: crea, luego "unchanged" con el mismo hash, luego actualiza con uno distinto', async () => {
    const tenant = await createTestTenant();
    const first = await upsertKnowledgeDocument(tenant.id, { sourceUrl: 'https://cliente.com/faq', title: 'FAQ', contentHash: 'v1' });
    expect(first.changed).toBe(true);

    const unchanged = await upsertKnowledgeDocument(tenant.id, { sourceUrl: 'https://cliente.com/faq', title: 'FAQ', contentHash: 'v1' });
    expect(unchanged.changed).toBe(false);
    expect(unchanged.id).toBe(first.id);

    const updated = await upsertKnowledgeDocument(tenant.id, { sourceUrl: 'https://cliente.com/faq', title: 'FAQ v2', contentHash: 'v2' });
    expect(updated.changed).toBe(true);
    expect(updated.id).toBe(first.id);
  });

  it('el mismo source_url en dos tenants distintos crea documentos separados', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const docA = await upsertKnowledgeDocument(tenantA.id, { sourceUrl: 'https://mismo.com/faq', title: 'FAQ', contentHash: 'v1' });
    const docB = await upsertKnowledgeDocument(tenantB.id, { sourceUrl: 'https://mismo.com/faq', title: 'FAQ', contentHash: 'v1' });
    expect(docA.id).not.toBe(docB.id);
  });

  it('replaceKnowledgeChunks reemplaza todos los chunks del documento (borra los viejos)', async () => {
    const tenant = await createTestTenant();
    const doc = await upsertKnowledgeDocument(tenant.id, { sourceUrl: 'https://cliente.com/faq', title: 'FAQ', contentHash: 'v1' });

    await replaceKnowledgeChunks(doc.id, [{ section: 'Envios', content: 'La entrega tarda 3 dias habiles', contentHash: 'c1' }]);
    let results = await searchKnowledgeByFullText(tenant.id, 'entrega', 5);
    expect(results).toHaveLength(1);

    await replaceKnowledgeChunks(doc.id, [{ section: 'Garantia', content: 'La garantia es de 12 meses', contentHash: 'c2' }]);
    results = await searchKnowledgeByFullText(tenant.id, 'entrega', 5);
    expect(results).toHaveLength(0);
    results = await searchKnowledgeByFullText(tenant.id, 'garantia', 5);
    expect(results).toHaveLength(1);
  });

  it('searchKnowledgeByFullText usa OR entre palabras — una pregunta con relleno igual encuentra la respuesta', async () => {
    const tenant = await createTestTenant();
    const doc = await upsertKnowledgeDocument(tenant.id, { sourceUrl: 'https://cliente.com/faq', title: 'FAQ', contentHash: 'v1' });
    await replaceKnowledgeChunks(doc.id, [{ section: 'Envios', content: 'El tiempo de envío es de 3 a 5 días hábiles', contentHash: 'c1' }]);

    // Ni "cuánto" ni "tarda" aparecen en la respuesta, solo "envío" — un AND
    // estricto entre las tres palabras de la pregunta no encontraria nada.
    const results = await searchKnowledgeByFullText(tenant.id, '¿cuánto tarda el envío?', 5);
    expect(results).toHaveLength(1);
  });

  it('searchKnowledgeByFullText/ByVector nunca mezclan contenido entre tenants', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const docA = await upsertKnowledgeDocument(tenantA.id, { sourceUrl: 'https://a.com/faq', title: 'FAQ A', contentHash: 'v1' });
    await replaceKnowledgeChunks(docA.id, [{ section: null, content: 'Contenido exclusivo del tenant A', contentHash: 'c1' }]);

    expect(await searchKnowledgeByFullText(tenantA.id, 'exclusivo', 5)).toHaveLength(1);
    expect(await searchKnowledgeByFullText(tenantB.id, 'exclusivo', 5)).toHaveLength(0);
  });

  it('searchKnowledgeByFullText no lanza error con una consulta que es solo stopwords', async () => {
    const tenant = await createTestTenant();
    await expect(searchKnowledgeByFullText(tenant.id, 'el la de', 5)).resolves.toEqual([]);
  });

  it('upsertKnowledgeEmbedding + searchKnowledgeByVector ordenan por similitud coseno, acotado al tenant', async () => {
    const tenant = await createTestTenant();
    const doc = await upsertKnowledgeDocument(tenant.id, { sourceUrl: 'https://cliente.com/faq', title: 'FAQ', contentHash: 'v1' });
    const [chunkId] = await replaceKnowledgeChunks(doc.id, [{ section: null, content: 'contenido', contentHash: 'c1' }]);

    await upsertKnowledgeEmbedding(chunkId, unitVector(1024, 7), 'qwen-v1');

    const matches = await searchKnowledgeByVector(tenant.id, `[${unitVector(1024, 7).join(',')}]`, 5);
    expect(matches[0].chunkId).toBe(chunkId);
    expect(matches[0].score).toBeCloseTo(1, 5);
  });

  it('getChunksWithoutEmbeddings solo trae chunks de ese tenant que todavia no tienen embedding', async () => {
    const tenant = await createTestTenant();
    const doc = await upsertKnowledgeDocument(tenant.id, { sourceUrl: 'https://cliente.com/faq', title: 'FAQ', contentHash: 'v1' });
    const [withEmbedding, withoutEmbedding] = await replaceKnowledgeChunks(doc.id, [
      { section: null, content: 'chunk con embedding', contentHash: 'c1' },
      { section: null, content: 'chunk sin embedding', contentHash: 'c2' },
    ]);
    await upsertKnowledgeEmbedding(withEmbedding, unitVector(1024, 9), 'qwen-v1');

    const pending = await getChunksWithoutEmbeddings(tenant.id, 100);
    expect(pending.map((c) => c.id)).toContain(withoutEmbedding);
    expect(pending.map((c) => c.id)).not.toContain(withEmbedding);
  });
});
