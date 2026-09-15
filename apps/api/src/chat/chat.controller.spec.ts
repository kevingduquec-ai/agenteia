import { NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TenantRow } from '@prefiero-ia/database';

const { getConversationTenantIdMock } = vi.hoisted(() => ({ getConversationTenantIdMock: vi.fn() }));
vi.mock('@prefiero-ia/database', () => ({
  getConversationTenantId: getConversationTenantIdMock,
  RatingNotAllowedError: class RatingNotAllowedError extends Error {},
}));

const { ChatController } = await import('./chat.controller.js');

function tenant(id: string): TenantRow {
  return {
    id,
    slug: id,
    name: id,
    host: `${id}.localhost`,
    crawlerBaseUrl: 'https://example.com',
    extraCorsOrigins: null,
    maxAdminSeats: 1,
    maxSupportSeats: 1,
    isActive: true,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ChatController — verificacion de propiedad de la conversacion', () => {
  it('SEGURIDAD: sendMessage rechaza un conversationId real que pertenece a OTRO tenant (evita leer/escribir chats ajenos adivinando/reusando un UUID)', async () => {
    getConversationTenantIdMock.mockResolvedValueOnce('tenant-ajeno');
    const sendMessage = vi.fn();
    const controller = new ChatController({ sendMessage } as never);

    await expect(controller.sendMessage({ conversationId: 'conv-1', message: 'hola' }, tenant('tenant-mio'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('un conversationId inexistente (tenant_id null) tambien se rechaza como "no existe"', async () => {
    getConversationTenantIdMock.mockResolvedValueOnce(null);
    const sendMessage = vi.fn();
    const controller = new ChatController({ sendMessage } as never);

    await expect(controller.sendMessage({ conversationId: 'conv-inventado', message: 'hola' }, tenant('tenant-mio'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('un conversationId que SI pertenece al tenant correcto, procede normalmente', async () => {
    getConversationTenantIdMock.mockResolvedValueOnce('tenant-mio');
    const sendMessage = vi.fn().mockResolvedValue({ intent: 'GENERAL_CHAT', content: 'hola' });
    const controller = new ChatController({ sendMessage } as never);

    const result = await controller.sendMessage({ conversationId: 'conv-1', message: 'hola' }, tenant('tenant-mio'));
    expect(sendMessage).toHaveBeenCalledWith('tenant-mio', 'conv-1', 'hola', undefined);
    expect(result).toEqual({ intent: 'GENERAL_CHAT', content: 'hola' });
  });

  it('status() aplica la misma verificacion antes de consultar el estado', async () => {
    getConversationTenantIdMock.mockResolvedValueOnce('tenant-ajeno');
    const getConversationState = vi.fn();
    const controller = new ChatController({ getConversationState } as never);

    await expect(controller.status({ conversationId: 'conv-1' }, tenant('tenant-mio'))).rejects.toBeInstanceOf(NotFoundException);
    expect(getConversationState).not.toHaveBeenCalled();
  });
});
