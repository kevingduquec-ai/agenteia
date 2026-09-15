import { describe, expect, it, vi } from 'vitest';
import type { GenerateResult, LLMGateway } from '@prefiero-ia/llm';
import { classifyIntent } from './intent-router.js';

function result(content: string | null): GenerateResult {
  return { content, toolCalls: [], finishReason: 'stop', provider: 'qwen', model: 'm', usage: { inputTokens: 1, outputTokens: 1 } };
}

function fakeGateway(generate: ReturnType<typeof vi.fn>): LLMGateway {
  return { generate } as unknown as LLMGateway;
}

describe('classifyIntent', () => {
  it('devuelve la categoria que el LLM respondio, en mayusculas', async () => {
    const generate = vi.fn().mockResolvedValue(result('product_search'));
    const intent = await classifyIntent({ gateway: fakeGateway(generate), message: 'busco un celular' });
    expect(intent).toBe('PRODUCT_SEARCH');
  });

  it('limpia puntuacion/espacios alrededor de la respuesta del LLM', async () => {
    const generate = vi.fn().mockResolvedValue(result(' "GENERAL_CHAT". '));
    const intent = await classifyIntent({ gateway: fakeGateway(generate), message: 'hola' });
    expect(intent).toBe('GENERAL_CHAT');
  });

  it('degrada a GENERAL_CHAT si el LLM responde algo que no es una categoria valida', async () => {
    const generate = vi.fn().mockResolvedValue(result('no tengo idea de que categoria es esta'));
    const intent = await classifyIntent({ gateway: fakeGateway(generate), message: 'algo ambiguo' });
    expect(intent).toBe('GENERAL_CHAT');
  });

  it('degrada a GENERAL_CHAT si el contenido viene vacio (ej. maxTokens agotado en tokens de razonamiento)', async () => {
    const generate = vi.fn().mockResolvedValue(result(''));
    const intent = await classifyIntent({ gateway: fakeGateway(generate), message: 'hola' });
    expect(intent).toBe('GENERAL_CHAT');
  });

  it('degrada a GENERAL_CHAT si el LLM no esta configurado (generate lanza)', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('LLMNotConfiguredError'));
    const intent = await classifyIntent({ gateway: fakeGateway(generate), message: 'hola' });
    expect(intent).toBe('GENERAL_CHAT');
  });

  it('incluye la nota de contexto de pagina en el system prompt cuando se provee', async () => {
    const generate = vi.fn().mockResolvedValue(result('PRODUCT_QUESTION'));
    await classifyIntent({ gateway: fakeGateway(generate), message: '¿cuanto cuesta esto?', pageContextNote: 'Contexto de pagina: iPhone 15' });

    const systemMessage = generate.mock.calls[0][0].messages[0];
    expect(systemMessage.content).toContain('Contexto de pagina: iPhone 15');
  });

  it('solo manda los ultimos 4 mensajes de historial (acota el costo del clasificador)', async () => {
    const generate = vi.fn().mockResolvedValue(result('GENERAL_CHAT'));
    const history = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, content: `mensaje ${i}` }));
    await classifyIntent({ gateway: fakeGateway(generate), message: 'ultimo', history });

    const messages = generate.mock.calls[0][0].messages;
    // El primer mensaje es el system prompt, el ultimo es el mensaje actual —
    // en medio van, como maximo, 4 mensajes de historial.
    expect(messages.length).toBeLessThanOrEqual(1 + 4 + 1);
  });
});
