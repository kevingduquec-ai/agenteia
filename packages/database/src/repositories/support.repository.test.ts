import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '../pool.js';
import { createTestTenant } from '../../test/fixtures.js';
import { addMessage, getOrCreateConversation, getOrCreateSession } from './chat.repository.js';
import {
  addSupportAgentMessage,
  cancelConversation,
  closeConversation,
  countConversationsHandledSince,
  getConversationStatus,
  getConversationTenantId,
  getSupportResponseStats,
  listSupportConversations,
  markConversationNeedsSupport,
  resolveConversation,
} from './support.repository.js';

afterAll(async () => {
  await closePool();
});

async function newConversation(tenantId: string) {
  const session = await getOrCreateSession(tenantId, randomUUID());
  return getOrCreateConversation(tenantId, session.id);
}

describe('support.repository', () => {
  it('una conversacion nueva empieza en "active"', async () => {
    const tenant = await createTestTenant();
    const conversation = await newConversation(tenant.id);
    expect(await getConversationStatus(conversation.id)).toBe('active');
  });

  it('getConversationTenantId es la base de la verificacion de propiedad — nunca confunde el tenant de una conversacion', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const conversationA = await newConversation(tenantA.id);

    expect(await getConversationTenantId(conversationA.id)).toBe(tenantA.id);
    expect(await getConversationTenantId(conversationA.id)).not.toBe(tenantB.id);
  });

  it('getConversationTenantId devuelve null para un id que no existe (adivinado)', async () => {
    expect(await getConversationTenantId(randomUUID())).toBeNull();
  });

  it('markConversationNeedsSupport solo aplica desde "active" — no reabre una ya resuelta/cerrada', async () => {
    const tenant = await createTestTenant();
    const conversation = await newConversation(tenant.id);
    await resolveConversation(conversation.id);

    await markConversationNeedsSupport(conversation.id);
    expect(await getConversationStatus(conversation.id)).toBe('resolved');
  });

  it('resolver/cerrar/cancelar cambian el estado', async () => {
    const tenant = await createTestTenant();
    const conversation = await newConversation(tenant.id);
    await markConversationNeedsSupport(conversation.id);
    expect(await getConversationStatus(conversation.id)).toBe('needs_support');

    await closeConversation(conversation.id);
    expect(await getConversationStatus(conversation.id)).toBe('closed');

    const other = await newConversation(tenant.id);
    await cancelConversation(other.id);
    expect(await getConversationStatus(other.id)).toBe('cancelled');
  });

  it('addSupportAgentMessage registra el mensaje y getSupportResponseStats mide el tiempo hasta la primera respuesta', async () => {
    const tenant = await createTestTenant();
    const conversation = await newConversation(tenant.id);
    await addMessage(conversation.id, 'user', 'Necesito ayuda con mi pedido');
    await markConversationNeedsSupport(conversation.id);
    await addSupportAgentMessage(conversation.id, 'Claro, cuentame que pasa');

    const since = new Date(Date.now() - 60_000);
    const stats = await getSupportResponseStats(tenant.id, since);
    expect(stats.escalated).toBeGreaterThanOrEqual(1);
    expect(stats.answered).toBeGreaterThanOrEqual(1);
    expect(stats.averageResponseSeconds).not.toBeNull();
  });

  it('countConversationsHandledSince cuenta conversaciones distintas con al menos una respuesta de agente', async () => {
    const tenant = await createTestTenant();
    const conversation = await newConversation(tenant.id);
    await markConversationNeedsSupport(conversation.id);
    await addSupportAgentMessage(conversation.id, 'Respuesta 1');
    await addSupportAgentMessage(conversation.id, 'Respuesta 2');

    const since = new Date(Date.now() - 60_000);
    expect(await countConversationsHandledSince(tenant.id, since)).toBe(1);
  });

  it('listSupportConversations solo lista lo de ESE tenant, en los estados pedidos', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const conversationA = await newConversation(tenantA.id);
    await markConversationNeedsSupport(conversationA.id);
    const conversationB = await newConversation(tenantB.id);
    await markConversationNeedsSupport(conversationB.id);

    const listA = await listSupportConversations(tenantA.id, ['needs_support']);
    expect(listA.map((c) => c.conversationId)).toEqual([conversationA.id]);
  });
});
