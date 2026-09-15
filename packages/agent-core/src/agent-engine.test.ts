import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerateResult, LLMGateway, StreamChunk } from '@prefiero-ia/llm';

const { catalogToolByIntentMock, fakeHandler } = vi.hoisted(() => {
  const fakeHandler = vi.fn();
  const definition = (name: string) => ({ name, description: 'x', parameters: { type: 'object' as const, properties: {} } });
  return {
    fakeHandler,
    catalogToolByIntentMock: {
      PRODUCT_SEARCH: { name: 'search_products', definition: definition('search_products'), handler: fakeHandler, extractionPrompt: 'extraccion busqueda' },
      GIFT_RECOMMENDATION: { name: 'recommend_gift', definition: definition('recommend_gift'), handler: fakeHandler, extractionPrompt: 'extraccion regalo' },
    },
  };
});

const { markConversationNeedsSupportMock, insertUnmetDemandMock } = vi.hoisted(() => ({
  markConversationNeedsSupportMock: vi.fn().mockResolvedValue(undefined),
  insertUnmetDemandMock: vi.fn().mockResolvedValue({ id: 'demand-1' }),
}));

vi.mock('./catalog-tools.js', () => ({ buildCatalogToolByIntent: () => catalogToolByIntentMock }));
vi.mock('@prefiero-ia/database', () => ({
  markConversationNeedsSupport: markConversationNeedsSupportMock,
  insertUnmetDemand: insertUnmetDemandMock,
}));
vi.mock('@prefiero-ia/catalog', () => ({
  resolveProductFromPageContext: vi.fn().mockResolvedValue(null),
  formatCOP: (n: number) => `$${n}`,
}));

const { AgentEngine } = await import('./agent-engine.js');
type RunAgentInput = Parameters<InstanceType<typeof AgentEngine>['run']>[0];

afterEach(() => {
  fakeHandler.mockReset();
  markConversationNeedsSupportMock.mockClear();
  insertUnmetDemandMock.mockClear();
});

function usage() {
  return { inputTokens: 1, outputTokens: 1 };
}

function textResult(content: string | null): GenerateResult {
  return { content, toolCalls: [], finishReason: 'stop', provider: 'qwen', model: 'm', usage: usage() };
}

function toolCallResult(args: Record<string, unknown> | undefined): GenerateResult {
  return {
    content: null,
    toolCalls: args ? [{ id: '1', name: 'x', arguments: args }] : [],
    finishReason: args ? 'tool_calls' : 'stop',
    provider: 'qwen',
    model: 'm',
    usage: usage(),
  };
}

function fakeGateway(opts: {
  generate?: ReturnType<typeof vi.fn>;
  callTools?: ReturnType<typeof vi.fn>;
  stream?: (options: unknown) => AsyncGenerator<StreamChunk, GenerateResult, void>;
}): LLMGateway {
  return {
    generate: opts.generate ?? vi.fn().mockResolvedValue(textResult('GENERAL_CHAT')),
    callTools: opts.callTools ?? vi.fn().mockResolvedValue(toolCallResult(undefined)),
    stream: opts.stream ?? (async function* () {
      yield { delta: 'ok', done: true };
      return textResult('ok');
    }),
  } as unknown as LLMGateway;
}

function baseInput(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    tenantId: 'tenant-1',
    systemPrompt: 'Eres Prefi',
    history: [],
    userMessage: 'hola',
    maxTokens: 300,
    conversationId: 'conv-1',
    ...overrides,
  };
}

describe('AgentEngine.run — casos que cortan antes de clasificar', () => {
  it('conversationStatus "needs_support": responde el mensaje de espera sin llamar al LLM', async () => {
    const generate = vi.fn();
    const engine = new AgentEngine(fakeGateway({ generate }));

    const result = await engine.run(baseInput({ conversationStatus: 'needs_support' }));
    expect(result.intent).toBe('HUMAN_SUPPORT');
    expect(generate).not.toHaveBeenCalled();
  });

  it('forceHumanSupport: escala a soporte y responde sin clasificar', async () => {
    const generate = vi.fn();
    const engine = new AgentEngine(fakeGateway({ generate }));

    const result = await engine.run(baseInput({ forceHumanSupport: true }));
    expect(result.intent).toBe('HUMAN_SUPPORT');
    expect(generate).not.toHaveBeenCalled();
    expect(markConversationNeedsSupportMock).toHaveBeenCalledWith('conv-1');
  });

  it('forceHumanSupport sin conversationId no intenta marcar nada (best-effort, nunca falla)', async () => {
    const engine = new AgentEngine(fakeGateway({}));
    await engine.run(baseInput({ forceHumanSupport: true, conversationId: null }));
    expect(markConversationNeedsSupportMock).not.toHaveBeenCalled();
  });
});

describe('AgentEngine.run — clasificacion a HUMAN_SUPPORT/PRIVATE_CUSTOMER_DATA/UNKNOWN', () => {
  it('clasifica HUMAN_SUPPORT: escala y responde el mensaje fijo', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('HUMAN_SUPPORT'));
    const engine = new AgentEngine(fakeGateway({ generate }));

    const result = await engine.run(baseInput());
    expect(result.intent).toBe('HUMAN_SUPPORT');
    expect(markConversationNeedsSupportMock).toHaveBeenCalledWith('conv-1');
  });

  it('clasifica PRIVATE_CUSTOMER_DATA: corta con el mensaje fijo, sin segunda llamada al LLM', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('PRIVATE_CUSTOMER_DATA'));
    const engine = new AgentEngine(fakeGateway({ generate }));

    const result = await engine.run(baseInput());
    expect(result.intent).toBe('PRIVATE_CUSTOMER_DATA');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('clasifica UNKNOWN: corta con el mensaje fijo, sin gastar una segunda llamada de generacion', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('UNKNOWN'));
    const engine = new AgentEngine(fakeGateway({ generate }));

    const result = await engine.run(baseInput());
    expect(result.intent).toBe('UNKNOWN');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('intent normal (ej. FAQ): responde con la generacion libre del LLM (RAG+LLM)', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('FAQ')).mockResolvedValueOnce(textResult('La entrega tarda 3 dias.'));
    const engine = new AgentEngine(fakeGateway({ generate }));

    const result = await engine.run(baseInput());
    expect(result.intent).toBe('FAQ');
    expect(result.content).toBe('La entrega tarda 3 dias.');
  });

  it('si la generacion libre devuelve contenido vacio, usa el mensaje honesto por defecto', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('FAQ')).mockResolvedValueOnce(textResult(''));
    const engine = new AgentEngine(fakeGateway({ generate }));

    const result = await engine.run(baseInput());
    expect(result.content).toBe('No tengo una respuesta clara para eso en este momento.');
  });
});

describe('AgentEngine.run — intenciones dependientes de catalogo', () => {
  it('feliz: extrae argumentos, ejecuta la tool real y redacta con el resultado', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('PRODUCT_SEARCH')).mockResolvedValueOnce(textResult('Aqui tienes un mouse.'));
    const callTools = vi.fn().mockResolvedValueOnce(toolCallResult({ text: 'mouse' }));
    fakeHandler.mockResolvedValueOnce({ count: 1, products: [{ id: 'p1', name: 'Mouse', price: 20000 }] });
    const engine = new AgentEngine(fakeGateway({ generate, callTools }));

    const result = await engine.run(baseInput());
    expect(fakeHandler).toHaveBeenCalledWith({ text: 'mouse' }, { tenantId: 'tenant-1' });
    expect(result.content).toBe('Aqui tienes un mouse.');
    expect(result.products).toEqual([{ id: 'p1', name: 'Mouse', price: 20000 }]);
    expect(insertUnmetDemandMock).not.toHaveBeenCalled();
  });

  it('intent catalogo sin tool registrada todavia: responde honesto y registra la demanda', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('BUDGET_SEARCH')).mockResolvedValueOnce(toolCallResult({ requestedCategory: 'celulares' }));
    const engine = new AgentEngine(fakeGateway({ generate }));

    const result = await engine.run(baseInput());
    expect(result.content).toMatch(/en construcción/);
    expect(fakeHandler).not.toHaveBeenCalled();
    expect(insertUnmetDemandMock).toHaveBeenCalled();
  });

  it('si la extraccion no llama a la tool (sin toolCalls), responde honesto y registra la demanda', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('PRODUCT_SEARCH')).mockResolvedValueOnce(toolCallResult(undefined));
    const callTools = vi.fn().mockResolvedValueOnce(toolCallResult(undefined));
    const engine = new AgentEngine(fakeGateway({ generate, callTools }));

    const result = await engine.run(baseInput());
    expect(result.content).toMatch(/No logré entender/);
    expect(fakeHandler).not.toHaveBeenCalled();
    expect(insertUnmetDemandMock).toHaveBeenCalled();
  });

  it('si la extraccion (callTools) lanza un error, responde honesto y registra la demanda', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('PRODUCT_SEARCH')).mockResolvedValueOnce(toolCallResult(undefined));
    const callTools = vi.fn().mockRejectedValueOnce(new Error('LLM caido'));
    const engine = new AgentEngine(fakeGateway({ generate, callTools }));

    const result = await engine.run(baseInput());
    expect(result.content).toMatch(/No logré entender/);
    expect(fakeHandler).not.toHaveBeenCalled();
    expect(insertUnmetDemandMock).toHaveBeenCalled();
  });

  it('si el handler de la tool lanza, responde honesto y registra la demanda (nunca revienta la respuesta)', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('PRODUCT_SEARCH')).mockResolvedValueOnce(toolCallResult(undefined));
    const callTools = vi.fn().mockResolvedValueOnce(toolCallResult({ text: 'mouse' }));
    fakeHandler.mockRejectedValueOnce(new Error('DB caida'));
    const engine = new AgentEngine(fakeGateway({ generate, callTools }));

    const result = await engine.run(baseInput());
    expect(result.content).toMatch(/No logré entender/);
    expect(insertUnmetDemandMock).toHaveBeenCalled();
  });

  it('resultado vacio del catalogo (count 0): SI redacta con el LLM, pero tambien registra la demanda', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('PRODUCT_SEARCH')).mockResolvedValueOnce(textResult('No encontré nada de eso.'));
    const callTools = vi.fn().mockResolvedValueOnce(toolCallResult({ text: 'algo raro' }));
    fakeHandler.mockResolvedValueOnce({ count: 0, products: [] });
    const engine = new AgentEngine(fakeGateway({ generate, callTools }));

    const result = await engine.run(baseInput());
    expect(result.content).toBe('No encontré nada de eso.');
    expect(insertUnmetDemandMock).toHaveBeenCalled();
  });

  it('GIFT_RECOMMENDATION sin genero/edad ni interes/categoria: pregunta en vez de buscar, sin ejecutar la tool', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('GIFT_RECOMMENDATION'));
    const callTools = vi.fn().mockResolvedValueOnce(toolCallResult({ recipientDescription: 'mi hermana, tiene 25 años' }));
    const engine = new AgentEngine(fakeGateway({ generate, callTools }));

    const result = await engine.run(baseInput());
    expect(result.content).toMatch(/\?/);
    expect(fakeHandler).not.toHaveBeenCalled();
    // Solo una llamada de generate (la clasificacion) — la pregunta aclaratoria es texto fijo, no una segunda generacion.
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('GIFT_RECOMMENDATION con genero e interes ya extraidos: SI ejecuta la tool normalmente', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('GIFT_RECOMMENDATION')).mockResolvedValueOnce(textResult('Un perfume para tu mama.'));
    const callTools = vi.fn().mockResolvedValueOnce(toolCallResult({ recipientDescription: 'mi mama', recipientGender: 'mujer', interests: 'perfumes' }));
    fakeHandler.mockResolvedValueOnce({ count: 1, recommendations: [{ product: { id: 'p1', name: 'Perfume' }, reasons: [] }] });
    const engine = new AgentEngine(fakeGateway({ generate, callTools }));

    const result = await engine.run(baseInput());
    expect(fakeHandler).toHaveBeenCalled();
    expect(result.products).toEqual([{ id: 'p1', name: 'Perfume' }]);
  });
});

describe('AgentEngine.runStream', () => {
  it('needs_support: emite un solo chunk final con el mensaje de espera', async () => {
    const engine = new AgentEngine(fakeGateway({}));
    const chunks: StreamChunk[] = [];
    let final: unknown;
    const gen = engine.runStream(baseInput({ conversationStatus: 'needs_support' }));
    while (true) {
      const step = await gen.next();
      if (step.done) {
        final = step.value;
        break;
      }
      chunks.push(step.value);
    }
    expect(chunks).toEqual([{ delta: expect.any(String), done: true }]);
    expect((final as { intent: string }).intent).toBe('HUMAN_SUPPORT');
  });

  it('intent catalogo: extrae, ejecuta y transmite el contenido redactado como un solo chunk final', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('PRODUCT_SEARCH')).mockResolvedValueOnce(textResult('Aqui tienes un mouse.'));
    const callTools = vi.fn().mockResolvedValueOnce(toolCallResult({ text: 'mouse' }));
    fakeHandler.mockResolvedValueOnce({ count: 1, products: [] });
    const engine = new AgentEngine(fakeGateway({ generate, callTools }));

    const chunks: StreamChunk[] = [];
    for await (const chunk of engine.runStream(baseInput())) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ delta: 'Aqui tienes un mouse.', done: true }]);
  });

  it('chat general: transmite cada chunk del LLM y acumula el contenido final', async () => {
    const generate = vi.fn().mockResolvedValueOnce(textResult('GENERAL_CHAT'));
    const stream = async function* (): AsyncGenerator<StreamChunk, GenerateResult, void> {
      yield { delta: 'Hola', done: false };
      yield { delta: ', en que ayudo?', done: true };
      return textResult('Hola, en que ayudo?');
    };
    const engine = new AgentEngine(fakeGateway({ generate, stream }));

    const chunks: StreamChunk[] = [];
    const gen = engine.runStream(baseInput());
    let final: { content: string } | undefined;
    while (true) {
      const step = await gen.next();
      if (step.done) {
        final = step.value;
        break;
      }
      chunks.push(step.value);
    }
    expect(chunks.map((c) => c.delta)).toEqual(['Hola', ', en que ayudo?']);
    expect(final?.content).toBe('Hola, en que ayudo?');
  });
});
