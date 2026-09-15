import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '../pool.js';
import { createTestTenant } from '../../test/fixtures.js';
import {
  addMessage,
  createConversation,
  getFullConversationThread,
  getOrCreateConversation,
  getOrCreateSession,
  getPageContextForConversation,
  getRecentMessages,
} from './chat.repository.js';

afterAll(async () => {
  await closePool();
});

describe('chat.repository', () => {
  it('getOrCreateSession es atomico: dos llamadas concurrentes con el mismo id anonimo no chocan (ON CONFLICT)', async () => {
    const tenant = await createTestTenant();
    const anonymousId = randomUUID();

    const [a, b] = await Promise.all([
      getOrCreateSession(tenant.id, anonymousId),
      getOrCreateSession(tenant.id, anonymousId),
    ]);
    expect(a.id).toBe(b.id);
  });

  it('el mismo anonymousSessionId en dos tenants distintos crea sesiones separadas', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const anonymousId = randomUUID();

    const sessionA = await getOrCreateSession(tenantA.id, anonymousId);
    const sessionB = await getOrCreateSession(tenantB.id, anonymousId);
    expect(sessionA.id).not.toBe(sessionB.id);
  });

  it('getOrCreateConversation reutiliza la conversacion mas reciente de la sesion', async () => {
    const tenant = await createTestTenant();
    const session = await getOrCreateSession(tenant.id, randomUUID());

    const first = await getOrCreateConversation(tenant.id, session.id);
    const second = await getOrCreateConversation(tenant.id, session.id);
    expect(first.id).toBe(second.id);
  });

  it('createConversation siempre fuerza una conversacion nueva, aunque ya exista una', async () => {
    const tenant = await createTestTenant();
    const session = await getOrCreateSession(tenant.id, randomUUID());

    const first = await getOrCreateConversation(tenant.id, session.id);
    const forced = await createConversation(tenant.id, session.id);
    expect(forced.id).not.toBe(first.id);
  });

  it('addMessage guarda el mensaje y getRecentMessages solo trae user/assistant, en orden cronologico', async () => {
    const tenant = await createTestTenant();
    const session = await getOrCreateSession(tenant.id, randomUUID());
    const conversation = await getOrCreateConversation(tenant.id, session.id);

    await addMessage(conversation.id, 'user', 'Hola', null);
    await addMessage(conversation.id, 'assistant', 'Hola, en que te ayudo?', 'GENERAL_CHAT');
    await addMessage(conversation.id, 'support_agent', 'Un agente humano te va a atender');

    const recent = await getRecentMessages(conversation.id);
    expect(recent.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(recent[0].content).toBe('Hola');
  });

  it('getFullConversationThread SI incluye support_agent, en orden cronologico', async () => {
    const tenant = await createTestTenant();
    const session = await getOrCreateSession(tenant.id, randomUUID());
    const conversation = await getOrCreateConversation(tenant.id, session.id);

    await addMessage(conversation.id, 'user', 'Necesito ayuda humana');
    await addMessage(conversation.id, 'support_agent', 'Aqui estoy, cuentame');

    const thread = await getFullConversationThread(conversation.id);
    expect(thread.map((m) => m.role)).toEqual(['user', 'support_agent']);
  });

  it('getPageContextForConversation devuelve el contexto guardado al abrir la sesion', async () => {
    const tenant = await createTestTenant();
    const pageContext = { productSlug: 'iphone-15' };
    const session = await getOrCreateSession(tenant.id, randomUUID(), pageContext);
    const conversation = await getOrCreateConversation(tenant.id, session.id);

    expect(await getPageContextForConversation(conversation.id)).toEqual(pageContext);
  });
});
