import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '../pool.js';
import { createTestTenant, testProductInput } from '../../test/fixtures.js';
import { addMessage, getOrCreateConversation, getOrCreateSession } from './chat.repository.js';
import { upsertProduct } from './catalog.repository.js';
import { markConversationNeedsSupport } from './support.repository.js';
import { insertUnmetDemand } from './unmet-demand.repository.js';
import {
  countLiveVisitors,
  getConversationOverview,
  getImpactReport,
  getIntentBreakdown,
  getTopConsultedProducts,
  getUnmetDemandSummary,
  recordProductImpressions,
  recordSearchEvent,
} from './analytics.repository.js';

afterAll(async () => {
  await closePool();
});

async function newConversation(tenantId: string) {
  const session = await getOrCreateSession(tenantId, randomUUID());
  return getOrCreateConversation(tenantId, session.id);
}

describe('analytics.repository', () => {
  it('countLiveVisitors solo cuenta sesiones activas de ESE tenant', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    await getOrCreateSession(tenantA.id, randomUUID());
    await getOrCreateSession(tenantB.id, randomUUID());

    expect(await countLiveVisitors(tenantA.id, 5)).toBe(1);
  });

  it('recordProductImpressions + getTopConsultedProducts esta acotado por tenant', async () => {
    const tenant = await createTestTenant();
    const product = await upsertProduct(tenant.id, testProductInput({ name: 'Producto Consultado' }));
    const conversation = await newConversation(tenant.id);

    await recordProductImpressions(tenant.id, conversation.id, [product.id, product.id]);

    const top = await getTopConsultedProducts(tenant.id, 10, 7);
    expect(top.find((p) => p.productId === product.id)?.impressions).toBe(2);
  });

  it('recordProductImpressions con lista vacia no falla ni inserta nada', async () => {
    const tenant = await createTestTenant();
    await expect(recordProductImpressions(tenant.id, null, [])).resolves.toBeUndefined();
  });

  it('getUnmetDemandSummary agrupa por categoria+marca, acotado por tenant', async () => {
    const tenant = await createTestTenant();
    await insertUnmetDemand(tenant.id, { query: 'nevera barata', requestedCategory: 'Neveras' });
    await insertUnmetDemand(tenant.id, { query: 'otra nevera', requestedCategory: 'Neveras' });

    const summary = await getUnmetDemandSummary(tenant.id, 10, 30);
    expect(summary.find((row) => row.requestedCategory === 'Neveras')?.count).toBe(2);
  });

  it('getConversationOverview cuenta sesiones/conversaciones/mensajes de ESE tenant', async () => {
    const tenant = await createTestTenant();
    const conversation = await newConversation(tenant.id);
    await addMessage(conversation.id, 'user', 'Hola');
    await addMessage(conversation.id, 'assistant', 'Hola, en que ayudo');

    const overview = await getConversationOverview(tenant.id);
    expect(overview.totalConversations).toBeGreaterThanOrEqual(1);
    expect(overview.totalMessages).toBeGreaterThanOrEqual(2);
    expect(overview.conversationsToday).toBeGreaterThanOrEqual(1);
  });

  it('getIntentBreakdown solo cuenta mensajes del assistant con intent, de ESE tenant', async () => {
    const tenant = await createTestTenant();
    const conversation = await newConversation(tenant.id);
    await addMessage(conversation.id, 'assistant', 'respuesta', 'PRODUCT_SEARCH');
    await addMessage(conversation.id, 'assistant', 'otra respuesta', 'PRODUCT_SEARCH');
    await addMessage(conversation.id, 'user', 'mensaje del usuario', null);

    const breakdown = await getIntentBreakdown(tenant.id, 7);
    expect(breakdown).toEqual([{ intent: 'PRODUCT_SEARCH', count: 2 }]);
  });

  it('getImpactReport junta metricas de conversaciones, soporte y calificacion en un solo reporte por tenant', async () => {
    const tenant = await createTestTenant();
    const conversation = await newConversation(tenant.id);
    await addMessage(conversation.id, 'user', 'mensaje real');
    await addMessage(conversation.id, 'assistant', 'no entendi eso', 'UNKNOWN');
    await markConversationNeedsSupport(conversation.id);
    await recordSearchEvent(tenant.id, { query: 'algo', resultCount: 0 });

    const report = await getImpactReport(tenant.id, 7);
    expect(report.conversations).toBeGreaterThanOrEqual(1);
    expect(report.customerMessages).toBeGreaterThanOrEqual(1);
    expect(report.offTopicDeflected).toBeGreaterThanOrEqual(1);
    expect(report.supportEscalations).toBeGreaterThanOrEqual(1);
  });
});
