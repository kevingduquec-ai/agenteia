import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '../pool.js';
import { createTestTenant } from '../../test/fixtures.js';
import { addMessage, getOrCreateConversation, getOrCreateSession } from './chat.repository.js';
import { getRatingSummary, RatingNotAllowedError, submitConversationRating } from './feedback.repository.js';

afterAll(async () => {
  await closePool();
});

async function newConversationWithUserMessage(tenantId: string) {
  const session = await getOrCreateSession(tenantId, randomUUID());
  const conversation = await getOrCreateConversation(tenantId, session.id);
  await addMessage(conversation.id, 'user', 'Hola, tengo una pregunta');
  return conversation;
}

describe('feedback.repository', () => {
  it('rechaza calificar una conversacion sin ningun mensaje real del comprador', async () => {
    const tenant = await createTestTenant();
    const session = await getOrCreateSession(tenant.id, randomUUID());
    const emptyConversation = await getOrCreateConversation(tenant.id, session.id);

    await expect(submitConversationRating(tenant.id, emptyConversation.id, 5)).rejects.toBeInstanceOf(RatingNotAllowedError);
  });

  it('rechaza calificar una conversacion de otro tenant (aunque el conversationId sea real)', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const conversation = await newConversationWithUserMessage(tenantA.id);

    await expect(submitConversationRating(tenantB.id, conversation.id, 5)).rejects.toBeInstanceOf(RatingNotAllowedError);
  });

  it('acepta calificar una conversacion real con actividad, y una segunda calificacion actualiza en vez de fallar', async () => {
    const tenant = await createTestTenant();
    const conversation = await newConversationWithUserMessage(tenant.id);

    await submitConversationRating(tenant.id, conversation.id, 3, 'estuvo bien');
    await submitConversationRating(tenant.id, conversation.id, 5, 'mejor de lo que pensaba');

    const since = new Date(Date.now() - 60_000);
    const summary = await getRatingSummary(tenant.id, since);
    expect(summary.count).toBe(1);
    expect(summary.average).toBe(5);
    expect(summary.distribution[5]).toBe(1);
  });

  it('getRatingSummary solo agrega calificaciones de ESE tenant', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    await submitConversationRating(tenantA.id, (await newConversationWithUserMessage(tenantA.id)).id, 1);
    await submitConversationRating(tenantB.id, (await newConversationWithUserMessage(tenantB.id)).id, 5);

    const since = new Date(Date.now() - 60_000);
    expect((await getRatingSummary(tenantA.id, since)).average).toBe(1);
    expect((await getRatingSummary(tenantB.id, since)).average).toBe(5);
  });
});
