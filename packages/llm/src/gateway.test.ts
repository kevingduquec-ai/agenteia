import { describe, expect, it, vi } from 'vitest';
import { LLMGateway } from './gateway.js';
import { LLMNotConfiguredError } from './errors.js';
import type { GenerateOptions, GenerateResult, HealthCheckResult, LLMProvider, LLMProviderName, StreamChunk } from './types.js';

const OPTIONS: GenerateOptions = { messages: [{ role: 'user', content: 'hola' }] };

function result(provider: LLMProviderName, content = 'respuesta'): GenerateResult {
  return { content, toolCalls: [], finishReason: 'stop', provider, model: `${provider}-model`, usage: { inputTokens: 1, outputTokens: 1 } };
}

type StreamMode = 'yield-chunks' | 'throw-before-first' | 'throw-after-first';

/** Doble de prueba de `LLMProvider` — controla si esta "configurado" y como se comporta cada metodo, sin llamar a ningun proveedor real. */
class FakeProvider implements LLMProvider {
  readonly model = 'fake-model';
  configured = true;
  generateError: Error | null = null;
  streamMode: StreamMode = 'yield-chunks';
  streamChunks: StreamChunk[] = [{ delta: 'hola', done: false }];
  calls = { generate: 0, callTools: 0, stream: 0 };

  constructor(readonly name: LLMProviderName) {}

  isConfigured(): boolean {
    return this.configured;
  }

  async generate(_options: GenerateOptions): Promise<GenerateResult> {
    this.calls.generate += 1;
    if (this.generateError) throw this.generateError;
    return result(this.name);
  }

  async callTools(options: GenerateOptions): Promise<GenerateResult> {
    this.calls.callTools += 1;
    return this.generate(options);
  }

  async *stream(_options: GenerateOptions): AsyncGenerator<StreamChunk, GenerateResult, void> {
    this.calls.stream += 1;
    if (this.streamMode === 'throw-before-first') {
      throw this.generateError ?? new Error(`${this.name} fallo antes del primer chunk`);
    }
    if (this.streamMode === 'throw-after-first') {
      yield this.streamChunks[0];
      throw this.generateError ?? new Error(`${this.name} fallo a mitad de stream`);
    }
    for (const chunk of this.streamChunks) {
      yield chunk;
    }
    return result(this.name);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { provider: this.name, configured: this.configured, ok: this.configured, model: this.model };
  }
}

function makeGateway(primary: FakeProvider, fallback: FakeProvider, onUsage?: (u: unknown) => void) {
  return new LLMGateway({
    providers: { qwen: primary, deepseek: fallback },
    primary: primary.name,
    fallback: fallback.name,
    onUsage,
  });
}

async function collectStream(gateway: LLMGateway): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gateway.stream(OPTIONS)) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('LLMGateway.generate / callTools (runWithFallback)', () => {
  it('usa el primario cuando esta configurado y responde bien, y reporta uso', async () => {
    const primary = new FakeProvider('qwen');
    const fallback = new FakeProvider('deepseek');
    const onUsage = vi.fn();
    const gateway = makeGateway(primary, fallback, onUsage);

    const res = await gateway.generate(OPTIONS);
    expect(res.provider).toBe('qwen');
    expect(fallback.calls.generate).toBe(0);
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'qwen' }));
  });

  it('si el primario falla y el fallback esta configurado, reintenta con el fallback', async () => {
    const primary = new FakeProvider('qwen');
    primary.generateError = new Error('qwen 500');
    const fallback = new FakeProvider('deepseek');
    const gateway = makeGateway(primary, fallback);

    const res = await gateway.generate(OPTIONS);
    expect(res.provider).toBe('deepseek');
    expect(primary.calls.generate).toBe(1);
  });

  it('si el primario falla y el fallback NO esta configurado, propaga el error original (no lo esconde)', async () => {
    const primary = new FakeProvider('qwen');
    primary.generateError = new Error('qwen 500');
    const fallback = new FakeProvider('deepseek');
    fallback.configured = false;
    const gateway = makeGateway(primary, fallback);

    await expect(gateway.generate(OPTIONS)).rejects.toThrow('qwen 500');
  });

  it('si el primario no esta configurado, usa el fallback directamente sin intentar el primario', async () => {
    const primary = new FakeProvider('qwen');
    primary.configured = false;
    const fallback = new FakeProvider('deepseek');
    const gateway = makeGateway(primary, fallback);

    const res = await gateway.generate(OPTIONS);
    expect(res.provider).toBe('deepseek');
    expect(primary.calls.generate).toBe(0);
  });

  it('si ningun proveedor esta configurado, lanza LLMNotConfiguredError', async () => {
    const primary = new FakeProvider('qwen');
    primary.configured = false;
    const fallback = new FakeProvider('deepseek');
    fallback.configured = false;
    const gateway = makeGateway(primary, fallback);

    await expect(gateway.generate(OPTIONS)).rejects.toBeInstanceOf(LLMNotConfiguredError);
  });

  it('si primario y fallback son el MISMO proveedor y falla, no reintenta contra si mismo', async () => {
    const shared = new FakeProvider('qwen');
    shared.generateError = new Error('qwen 500');
    const gateway = makeGateway(shared, shared);

    await expect(gateway.generate(OPTIONS)).rejects.toThrow('qwen 500');
    expect(shared.calls.generate).toBe(1);
  });

  it('callTools sigue la misma logica de fallback que generate', async () => {
    const primary = new FakeProvider('qwen');
    primary.generateError = new Error('qwen 500');
    const fallback = new FakeProvider('deepseek');
    const gateway = makeGateway(primary, fallback);

    const res = await gateway.callTools({ ...OPTIONS, tools: [] });
    expect(res.provider).toBe('deepseek');
  });
});

describe('LLMGateway.stream — fallback solo antes del primer chunk', () => {
  it('si el primario responde bien, transmite todo desde el primario y nunca toca el fallback', async () => {
    const primary = new FakeProvider('qwen');
    primary.streamChunks = [{ delta: 'ho', done: false }, { delta: 'la', done: false }];
    const fallback = new FakeProvider('deepseek');
    const gateway = makeGateway(primary, fallback);

    const chunks = await collectStream(gateway);
    expect(chunks).toEqual(primary.streamChunks);
    expect(fallback.calls.stream).toBe(0);
  });

  it('si el primario falla ANTES del primer chunk, la transmision completa viene del fallback', async () => {
    const primary = new FakeProvider('qwen');
    primary.streamMode = 'throw-before-first';
    const fallback = new FakeProvider('deepseek');
    fallback.streamChunks = [{ delta: 'respuesta del fallback', done: false }];
    const gateway = makeGateway(primary, fallback);

    const chunks = await collectStream(gateway);
    expect(chunks).toEqual(fallback.streamChunks);
    expect(primary.calls.stream).toBe(1);
    expect(fallback.calls.stream).toBe(1);
  });

  it('si el primario falla antes del primer chunk y no hay fallback configurado, propaga el error', async () => {
    const primary = new FakeProvider('qwen');
    primary.streamMode = 'throw-before-first';
    const fallback = new FakeProvider('deepseek');
    fallback.configured = false;
    const gateway = makeGateway(primary, fallback);

    await expect(collectStream(gateway)).rejects.toThrow(/fallo antes del primer chunk/);
  });

  it(
    'REGRESION: si el primario falla DESPUES de emitir el primer chunk, el error se propaga sin reintentar ' +
      '(nunca duplica/mezcla una respuesta que el usuario ya empezo a ver)',
    async () => {
      const primary = new FakeProvider('qwen');
      primary.streamMode = 'throw-after-first';
      const fallback = new FakeProvider('deepseek');
      const gateway = makeGateway(primary, fallback);

      await expect(collectStream(gateway)).rejects.toThrow(/fallo a mitad de stream/);
      expect(fallback.calls.stream).toBe(0);
    },
  );

  it('si el primario no esta configurado, transmite directo desde el fallback', async () => {
    const primary = new FakeProvider('qwen');
    primary.configured = false;
    const fallback = new FakeProvider('deepseek');
    fallback.streamChunks = [{ delta: 'solo fallback', done: false }];
    const gateway = makeGateway(primary, fallback);

    const chunks = await collectStream(gateway);
    expect(chunks).toEqual(fallback.streamChunks);
    expect(primary.calls.stream).toBe(0);
  });

  it('si ningun proveedor esta configurado, lanza LLMNotConfiguredError', async () => {
    const primary = new FakeProvider('qwen');
    primary.configured = false;
    const fallback = new FakeProvider('deepseek');
    fallback.configured = false;
    const gateway = makeGateway(primary, fallback);

    await expect(collectStream(gateway)).rejects.toBeInstanceOf(LLMNotConfiguredError);
  });
});

describe('LLMGateway.healthCheck', () => {
  it('reporta el estado de cada proveedor registrado', async () => {
    const primary = new FakeProvider('qwen');
    primary.configured = false;
    const fallback = new FakeProvider('deepseek');
    const gateway = makeGateway(primary, fallback);

    const health = await gateway.healthCheck();
    expect(health).toHaveLength(2);
    expect(health.find((h) => h.provider === 'qwen')?.configured).toBe(false);
    expect(health.find((h) => h.provider === 'deepseek')?.configured).toBe(true);
  });
});
