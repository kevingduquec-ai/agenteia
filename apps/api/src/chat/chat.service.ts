import { Injectable, Logger } from '@nestjs/common';
import { AgentEngine, type RunAgentInput } from '@prefiero-ia/agent-core';
import type { PageContext, ProductSummary } from '@prefiero-ia/catalog';
import {
  addMessage,
  createConversation,
  getConversationStatus,
  getFullConversationThread,
  getOrCreateConversation,
  getOrCreateSession,
  getPageContextForConversation,
  getRecentMessages,
  recordProductImpressions,
  recordSearchEvent,
  submitConversationRating,
  touchSessionByConversationId,
  type ChatMessageRow,
  type ConversationStatus,
} from '@prefiero-ia/database';
import { CATALOG_DEPENDENT_INTENTS, type Intent } from '@prefiero-ia/agent-core';
import { LLMGateway, LLMNotConfiguredError, loadQwenEmbeddingConfig, QwenEmbeddingProvider, type ChatMessage, type StreamChunk } from '@prefiero-ia/llm';
import { searchKnowledge } from '@prefiero-ia/rag';
import { buildContextBlock, SYSTEM_PROMPT } from './prompt.js';

const HISTORY_LIMIT = 10;
const KNOWLEDGE_LIMIT = 2;
// Tope duro de longitud de respuesta — el prompt ya pide precision y
// claridad, pero un limite de tokens es lo unico que garantiza que nunca se
// dispare de tamaño (los modelos no siempre respetan las instrucciones al
// pie de la letra). DeepSeek V4 es un modelo de razonamiento: los tokens de
// "pensamiento" interno tambien cuentan contra este limite, asi que debe
// dejar margen para eso ademas de la respuesta visible.
const MAX_RESPONSE_TOKENS = 700;

export const NOT_CONFIGURED_MESSAGE =
  'Todavía no tengo un agente inteligente conectado para responder — el equipo está terminando de configurarlo. Mientras tanto puedes revisar las preguntas frecuentes o escribirnos a servicioalcliente@prefieroacr.co.';

export interface StartSessionResult {
  sessionId: string;
  conversationId: string;
  history: ChatMessageRow[];
}

export interface ChatStreamChunk extends StreamChunk {
  products?: ProductSummary[];
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly gateway = LLMGateway.fromEnv(process.env, (usage) => {
    this.logger.log(
      `llm_usage provider=${usage.provider} model=${usage.model} input=${usage.inputTokens} output=${usage.outputTokens}`,
    );
  });
  private readonly embeddingProvider = new QwenEmbeddingProvider(loadQwenEmbeddingConfig());
  // Mismo proveedor que ya se usaba para la base de conocimiento — ahora
  // tambien alimenta la busqueda semantica de productos (recommend_products/
  // recommend_gift, ver `packages/agent-core`'s `semantic-candidates.ts`).
  // Si no esta configurado, `AgentEngine` sigue funcionando solo con
  // busqueda literal, sin romper nada.
  private readonly agentEngine = new AgentEngine(
    this.gateway,
    this.embeddingProvider.isConfigured() ? async (text: string) => (await this.embeddingProvider.embed(text)).embedding : undefined,
  );

  async startSession(tenantId: string, anonymousSessionId: string, pageContext?: PageContext): Promise<StartSessionResult> {
    const session = await getOrCreateSession(tenantId, anonymousSessionId, pageContext);
    const conversation = await getOrCreateConversation(tenantId, session.id);
    const history = await getRecentMessages(conversation.id, 30);
    return { sessionId: session.id, conversationId: conversation.id, history };
  }

  /** El usuario puede reiniciar la conversacion en cualquier momento — empieza una nueva, vacia, sin perder el historial anterior. */
  async startNewConversation(tenantId: string, sessionId: string): Promise<StartSessionResult> {
    const conversation = await createConversation(tenantId, sessionId);
    return { sessionId, conversationId: conversation.id, history: [] };
  }

  async sendMessage(
    tenantId: string,
    conversationId: string,
    userMessage: string,
    forceHumanSupport?: boolean,
  ): Promise<{ content: string; notConfigured?: boolean; products?: ProductSummary[] }> {
    const agentInput = await this.buildAgentInput(tenantId, conversationId, userMessage, forceHumanSupport);
    try {
      const { intent, content, products } = await this.agentEngine.run(agentInput);
      this.logger.log(`intent=${intent} conversation=${conversationId}`);
      await addMessage(conversationId, 'assistant', content, intent);
      await this.recordAnalyticsSafely(tenantId, conversationId, userMessage, intent, products);
      return { content, products };
    } catch (error) {
      if (error instanceof LLMNotConfiguredError) {
        await addMessage(conversationId, 'assistant', NOT_CONFIGURED_MESSAGE);
        return { content: NOT_CONFIGURED_MESSAGE, notConfigured: true };
      }
      throw error;
    }
  }

  async *streamMessage(
    tenantId: string,
    conversationId: string,
    userMessage: string,
    forceHumanSupport?: boolean,
  ): AsyncGenerator<ChatStreamChunk, void, void> {
    const agentInput = await this.buildAgentInput(tenantId, conversationId, userMessage, forceHumanSupport);
    try {
      const generator = this.agentEngine.runStream(agentInput);
      let step = await generator.next();
      while (!step.done) {
        yield step.value;
        step = await generator.next();
      }
      const { intent, content, products } = step.value;
      this.logger.log(`intent=${intent} conversation=${conversationId}`);
      await addMessage(conversationId, 'assistant', content || '(sin respuesta)', intent);
      await this.recordAnalyticsSafely(tenantId, conversationId, userMessage, intent, products);
      // Evento final extra con las cards de producto — el ultimo chunk de
      // texto ya pudo haber marcado done:true sin ellas (AgentEngine no
      // sabe de "cards", solo de texto); delta vacio no altera lo ya
      // mostrado, el frontend solo lo usa para pintar las tarjetas.
      if (products?.length) {
        yield { delta: '', done: true, products };
      }
    } catch (error) {
      if (!(error instanceof LLMNotConfiguredError)) {
        this.logger.error(`streamMessage fallo: ${error instanceof Error ? error.stack ?? error.message : error}`);
      }
      const message = error instanceof LLMNotConfiguredError ? NOT_CONFIGURED_MESSAGE : 'Ocurrió un error generando la respuesta. Intenta de nuevo en un momento.';
      await addMessage(conversationId, 'assistant', message);
      yield { delta: message, done: true };
    }
  }

  /** Pedido explicito del usuario: calificar la atencion al final de la conversacion — visible solo para admin/owner en el panel (`GET /admin/stats/support`), nunca para soporte ni para el comprador. */
  async rateConversation(tenantId: string, conversationId: string, rating: number, comment?: string): Promise<void> {
    await submitConversationRating(tenantId, conversationId, rating, comment);
  }

  /** Estado que consulta el widget del cliente (polling) para pintar respuestas de soporte y detectar cuando un agente resuelve/cierra/cancela — ver `ChatController`. */
  async getConversationState(conversationId: string): Promise<{ status: ConversationStatus | null; messages: ChatMessageRow[] }> {
    const [status, messages] = await Promise.all([
      getConversationStatus(conversationId),
      getFullConversationThread(conversationId),
    ]);
    return { status, messages };
  }

  private async buildAgentInput(
    tenantId: string,
    conversationId: string,
    userMessage: string,
    forceHumanSupport?: boolean,
  ): Promise<RunAgentInput> {
    await addMessage(conversationId, 'user', userMessage);

    const [history, knowledge, rawPageContext, conversationStatus] = await Promise.all([
      getRecentMessages(conversationId, HISTORY_LIMIT),
      this.searchKnowledgeSafely(tenantId, userMessage),
      getPageContextForConversation(conversationId),
      getConversationStatus(conversationId),
      // "Visitantes en vivo" (panel /admin) depende de esto — sin tocar la
      // sesion en cada mensaje, solo reflejaria quien abrio el chat una
      // vez, no quien esta conversando ahora mismo.
      touchSessionByConversationId(conversationId).catch(() => undefined),
    ]);

    const context = buildContextBlock(knowledge);
    const systemPrompt = context ? `${SYSTEM_PROMPT}\n\n${context}` : SYSTEM_PROMPT;

    return {
      tenantId,
      systemPrompt,
      history: history.slice(0, -1).map((h): ChatMessage => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
      userMessage,
      maxTokens: MAX_RESPONSE_TOKENS,
      conversationId,
      pageContext: asPageContext(rawPageContext),
      conversationStatus,
      forceHumanSupport,
    };
  }

  /**
   * Analitica del panel admin (sección 41-46) — nunca debe romper la
   * respuesta al usuario si falla, por eso corre despues de haber
   * respondido y con su propio try/catch.
   */
  private async recordAnalyticsSafely(
    tenantId: string,
    conversationId: string,
    userMessage: string,
    intent: Intent,
    products: ProductSummary[] | undefined,
  ): Promise<void> {
    try {
      if (products?.length) {
        await recordProductImpressions(tenantId, conversationId, products.map((p) => p.id));
      }
      if (CATALOG_DEPENDENT_INTENTS.has(intent)) {
        await recordSearchEvent(tenantId, { conversationId, query: userMessage, intent, resultCount: products?.length ?? 0 });
      }
    } catch (error) {
      this.logger.warn(`Analitica fallo, se ignora: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async searchKnowledgeSafely(tenantId: string, query: string) {
    try {
      const embed = this.embeddingProvider.isConfigured()
        ? async (text: string) => (await this.embeddingProvider.embed(text)).embedding
        : undefined;
      return await searchKnowledge(tenantId, query, { limit: KNOWLEDGE_LIMIT, embed });
    } catch (error) {
      this.logger.warn(`Busqueda de conocimiento fallo, se continua sin contexto: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }
}

/** `sessions.page_context` es jsonb sin esquema forzado en la DB — se valida su forma aqui en vez de confiar en un cast ciego. */
function asPageContext(value: unknown): PageContext | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const path = (value as Record<string, unknown>).path;
  return typeof path === 'string' ? { path } : undefined;
}
