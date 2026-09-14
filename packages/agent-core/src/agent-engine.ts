import { formatCOP, resolveProductFromPageContext, type PageContext, type ProductSummary } from '@prefiero-ia/catalog';
import { markConversationNeedsSupport, type ConversationStatus } from '@prefiero-ia/database';
import type { ChatMessage, LLMGateway, StreamChunk } from '@prefiero-ia/llm';
import { buildCatalogToolByIntent, type CatalogToolSpec } from './catalog-tools.js';
import { classifyIntent } from './intent-router.js';
import { CATALOG_DEPENDENT_INTENTS, type Intent } from './intent.js';
import type { EmbedFn } from './semantic-candidates.js';
import { ToolRegistry } from './tool-registry.js';
import {
  createRegisterUnmetDemandHandler,
  registerUnmetDemandToolDefinition,
  REGISTER_UNMET_DEMAND_TOOL_NAME,
} from './tools/register-unmet-demand.tool.js';
import { buildGiftClarifyingQuestion, needsMoreGiftInfo, type RecommendGiftArgs } from './tools/recommend-gift.tool.js';

const CATALOG_NOT_READY_MESSAGE =
  'Todavía no puedo buscar ni comparar productos del catálogo — esa función está en construcción. Mientras tanto puedo ayudarte con dudas sobre Crédito ACR, envíos, cambios o garantías.';

const CATALOG_EXTRACTION_FAILED_MESSAGE =
  'No logré entender bien los detalles de tu búsqueda. ¿Puedes contarme qué buscas, con más precisión (categoría, presupuesto o marca)?';

const PRIVATE_DATA_MESSAGE =
  'No puedo consultar ni cambiar datos de tu cuenta desde este chat (cupo, historial de compras, datos de contacto). Ingresa a tu perfil en el marketplace o escríbenos a servicioalcliente@prefieroacr.co.';

// Pedido explicito del usuario: cuando alguien pide hablar con soporte, la
// IA le pide que escriba que necesita y deja de responder por su cuenta —
// desde ahi un agente humano real atiende desde el panel admin.
const SUPPORT_ESCALATION_MESSAGE =
  'Entiendo que necesitas hablar con una persona. Cuéntame con el mayor detalle posible qué necesitas — un agente de soporte te va a responder en el menor tiempo posible.';

const SUPPORT_WAITING_MESSAGE = 'Gracias, ya quedó registrado. Un agente de soporte te va a responder en el menor tiempo posible.';

// Pedido explicito del usuario: este es un agente ESPECIALIZADO del
// marketplace, no un chat general — una pregunta sin nada que ver con
// Prefiero ACR+/Credito ACR no debe gastar una llamada de generacion al
// LLM (la clasificacion ya es la unica llamada necesaria). Mensaje fijo,
// profesional, sin sonar robotico ni cortante.
const UNKNOWN_MESSAGE =
  'Soy el asistente especializado de Prefiero ACR+ y Crédito ACR, así que no puedo ayudarte con eso. Con gusto te ayudo a buscar productos, resolver dudas sobre tu crédito, pagos, envíos o garantías.';

const EXTRACT_UNMET_DEMAND_PROMPT =
  'Extrae del mensaje del usuario, si estan presentes, la categoria de producto, la marca y el presupuesto/cuota en COP. Llama siempre a la tool con lo que puedas extraer (puedes omitir un campo si no aparece en el mensaje).';

const CATALOG_RESPONSE_PROMPT = `Eres "Prefi", el agente inteligente de compras del marketplace. Tienes un resultado REAL del catalogo de productos, en JSON, como unica fuente de verdad — nunca inventes ni completes con datos que no esten ahi (precio, marca, disponibilidad, atributos, links).

Lo mas importante: que la respuesta sea precisa y clara — no larga, no corta, la extension exacta que el dato necesite. Cada frase debe aportar un dato; si una frase no aporta nada nuevo, bórrala. Eso incluye NUNCA cerrar con una invitacion generica a preguntar mas ("¿quieres que te de mas detalle?", "¿te gustaria saber algo mas?") — si ya diste el dato que se pidio, ahi termina la respuesta.

Reglas:
- Si hay productos/resultados: presentalos de forma breve y clara. Para un producto, da nombre y precio en pesos colombianos. Para varios, usa una lista corta (maximo 5) con nombre y precio de cada uno.
- Si el JSON trae "reasons" para un producto, usalas para explicar brevemente por que se lo recomiendas — no inventes otras razones.
- Si el resultado esta vacio (count 0, found false, o una lista vacia) dilo en una frase honesta, sin ofrecer una alternativa que no puedas confirmar con datos reales. Si el JSON trae "note", basate en ella tal cual (es informacion real sobre por que no hay resultado).
- Nunca menciones que esto vino de una "tool", "JSON" o "base de datos" — habla como si simplemente conocieras el catalogo.
- Si el JSON trae "referenceProduct", eso confirma que SI encontraste el producto que el usuario menciono (se excluye a proposito de su propia lista de "similares"/"mas baratos" — que esa lista este vacia o no lo incluya no significa que no lo tengas registrado).
- El catalogo cambia todo el tiempo (productos nuevos, precios que suben o bajan, cosas que se agotan) — un producto con "isActive": false ya no esta en venta (fue descontinuado o retirado del catalogo desde la ultima actualizacion). Dilo claramente en vez de dar su precio como si siguiera disponible, y no lo cuentes como opcion valida en una lista o comparacion.
- Si el JSON trae "notFound" con nombres, dilo explicitamente para cada uno ("no encontré X") y sigue con lo que si encontraste en "found" — nunca dejes de mencionar un producto que no aparecio.`;

export interface RunAgentInput {
  systemPrompt: string;
  history: ChatMessage[];
  userMessage: string;
  maxTokens: number;
  conversationId?: string | null;
  /** Sección 33-34: si el usuario abrio el chat desde una ficha de producto del sitio real, esto trae la ruta que mando el widget embebido — se resuelve contra el catalogo real, nunca se confia en datos que el host pudiera mandar sobre precio/nombre. */
  pageContext?: PageContext | null;
  /** Si ya esta en 'needs_support', la IA no vuelve a responder por su cuenta — ver la clase AgentEngine. */
  conversationStatus?: ConversationStatus | null;
  /**
   * Tarjeta "Problemas con tu compra o tu pedido" del widget (pedido
   * explicito del usuario): fuerza HUMAN_SUPPORT sin pasar por el
   * clasificador — un comprador que ya viene frustrado por un pedido
   * dañado no puede depender de que la IA adivine bien la intencion.
   */
  forceHumanSupport?: boolean;
}

export interface RunAgentResult {
  intent: Intent;
  content: string;
  /** Productos reales detras de la respuesta (sección 35-40, "cards de producto") — para que el frontend los pinte como tarjeta en vez de que el usuario dependa solo del texto. Nunca mas de 5, en el mismo orden que se mencionan en `content`. */
  products?: ProductSummary[];
}

/**
 * Orquestador del agente (sección 87, paso 20). Decide, segun la intencion
 * detectada por el Intent Router, como responder:
 *
 * - Intenciones de catalogo (busqueda/recomendacion/comparacion de
 *   productos, sección 28): cada una tiene una tool real registrada en
 *   `catalog-tools.ts` (Fase 5). El flujo es: (1) un tool call le pide al
 *   LLM extraer los parametros del mensaje, (2) se ejecuta la tool contra
 *   el catalogo real, (3) un segundo llamado al LLM redacta la respuesta
 *   usando SOLO ese resultado como fuente de verdad — nunca se le pide al
 *   LLM que "busque" o "recomiende" libremente. Si la extraccion falla (el
 *   LLM no llamo a la tool, o no esta configurado) se responde honestamente
 *   en vez de adivinar, y de todas formas se registra la demanda para
 *   analitica (sección 34/Fase 8), tanto si fallo la extraccion como si la
 *   busqueda dio cero resultados reales.
 * - PRIVATE_CUSTOMER_DATA: no hay autenticacion de usuario todavia, asi que
 *   se corta con un mensaje fijo en vez de dejar que el LLM improvise.
 * - HUMAN_SUPPORT: la primera vez, pide el detalle y marca la conversacion
 *   `needs_support` — desde ahi (mientras un agente humano no la
 *   resuelva/cierre/cancele desde el panel admin) la IA NUNCA vuelve a
 *   responder por su cuenta, solo confirma que el mensaje quedo
 *   registrado. Evita que la IA siga "ayudando" despues de que el usuario
 *   pidio explicitamente una persona real. `forceHumanSupport` llega al
 *   mismo destino sin pasar por el clasificador (tarjeta "Problemas con tu
 *   compra o tu pedido" del widget).
 * - UNKNOWN: agente especializado del marketplace, no un chat general —
 *   una pregunta sin nada que ver con Prefiero ACR+/Credito ACR corta con
 *   un mensaje fijo, sin gastar la segunda llamada de generacion al LLM
 *   (la de clasificacion ya es la unica necesaria).
 * - GIFT_RECOMMENDATION: nunca recomienda a ciegas. Si la extraccion no
 *   pudo inferir genero ni edad del destinatario (de este mensaje o de la
 *   conversacion previa), pregunta antes de buscar en vez de adivinar.
 * - Todo lo demas sigue el flujo normal (RAG + LLM) que ya esta probado.
 */
export class AgentEngine {
  /** Construido una sola vez con el proveedor de embeddings del llamador (opcional) — ver `buildCatalogToolByIntent`. */
  private readonly catalogToolByIntent: Partial<Record<Intent, CatalogToolSpec>>;

  constructor(
    private readonly gateway: LLMGateway,
    embed?: EmbedFn,
  ) {
    this.catalogToolByIntent = buildCatalogToolByIntent(embed);
  }

  async run(input: RunAgentInput): Promise<RunAgentResult> {
    if (input.conversationStatus === 'needs_support') {
      return { intent: 'HUMAN_SUPPORT', content: SUPPORT_WAITING_MESSAGE };
    }

    if (input.forceHumanSupport) {
      await this.escalateToSupport(input);
      return { intent: 'HUMAN_SUPPORT', content: SUPPORT_ESCALATION_MESSAGE };
    }

    const pageContextNote = await this.resolvePageContextNote(input);
    const intent = await this.classify(input, pageContextNote);

    if (intent === 'HUMAN_SUPPORT') {
      await this.escalateToSupport(input);
      return { intent, content: SUPPORT_ESCALATION_MESSAGE };
    }

    if (CATALOG_DEPENDENT_INTENTS.has(intent)) {
      return this.runCatalogTool(intent, input, pageContextNote);
    }

    if (intent === 'PRIVATE_CUSTOMER_DATA') {
      return { intent, content: PRIVATE_DATA_MESSAGE };
    }

    if (intent === 'UNKNOWN') {
      return { intent, content: UNKNOWN_MESSAGE };
    }

    const result = await this.gateway.generate({
      messages: this.buildMessages(input, pageContextNote),
      maxTokens: input.maxTokens,
    });
    return { intent, content: result.content?.trim() || 'No tengo una respuesta clara para eso en este momento.' };
  }

  async *runStream(input: RunAgentInput): AsyncGenerator<StreamChunk, RunAgentResult, void> {
    if (input.conversationStatus === 'needs_support') {
      yield { delta: SUPPORT_WAITING_MESSAGE, done: true };
      return { intent: 'HUMAN_SUPPORT', content: SUPPORT_WAITING_MESSAGE };
    }

    if (input.forceHumanSupport) {
      await this.escalateToSupport(input);
      yield { delta: SUPPORT_ESCALATION_MESSAGE, done: true };
      return { intent: 'HUMAN_SUPPORT', content: SUPPORT_ESCALATION_MESSAGE };
    }

    const pageContextNote = await this.resolvePageContextNote(input);
    const intent = await this.classify(input, pageContextNote);

    if (intent === 'HUMAN_SUPPORT') {
      await this.escalateToSupport(input);
      yield { delta: SUPPORT_ESCALATION_MESSAGE, done: true };
      return { intent, content: SUPPORT_ESCALATION_MESSAGE };
    }

    if (CATALOG_DEPENDENT_INTENTS.has(intent)) {
      const result = await this.runCatalogTool(intent, input, pageContextNote);
      yield { delta: result.content, done: true };
      return result;
    }

    if (intent === 'PRIVATE_CUSTOMER_DATA') {
      yield { delta: PRIVATE_DATA_MESSAGE, done: true };
      return { intent, content: PRIVATE_DATA_MESSAGE };
    }

    if (intent === 'UNKNOWN') {
      yield { delta: UNKNOWN_MESSAGE, done: true };
      return { intent, content: UNKNOWN_MESSAGE };
    }

    let full = '';
    for await (const chunk of this.gateway.stream({ messages: this.buildMessages(input, pageContextNote), maxTokens: input.maxTokens })) {
      if (chunk.delta) {
        full += chunk.delta;
      }
      yield chunk;
    }
    return { intent, content: full.trim() };
  }

  private async escalateToSupport(input: RunAgentInput): Promise<void> {
    if (!input.conversationId) {
      return;
    }
    try {
      await markConversationNeedsSupport(input.conversationId);
    } catch {
      // Best-effort: si falla, la conversacion sigue 'active' y el
      // siguiente mensaje simplemente vuelve a intentar clasificar/escalar.
    }
  }

  private classify(input: RunAgentInput, pageContextNote: string | null): Promise<Intent> {
    return classifyIntent({ gateway: this.gateway, message: input.userMessage, history: input.history, pageContextNote });
  }

  private buildMessages(input: RunAgentInput, pageContextNote: string | null): ChatMessage[] {
    const systemPrompt = pageContextNote ? `${input.systemPrompt}\n\n${pageContextNote}` : input.systemPrompt;
    return [{ role: 'system', content: systemPrompt }, ...input.history, { role: 'user', content: input.userMessage }];
  }

  /** Best-effort: si no se puede resolver (sin pageContext, ruta no es de producto, o el producto ya no existe), simplemente no hay nota — nunca bloquea la respuesta. */
  private async resolvePageContextNote(input: RunAgentInput): Promise<string | null> {
    if (!input.pageContext) {
      return null;
    }
    try {
      const product = await resolveProductFromPageContext(input.pageContext);
      return product ? buildPageContextNote(product) : null;
    } catch {
      return null;
    }
  }

  private async runCatalogTool(intent: Intent, input: RunAgentInput, pageContextNote: string | null): Promise<RunAgentResult> {
    const spec = this.catalogToolByIntent[intent];
    if (!spec) {
      await this.registerUnmetDemand(intent, input);
      return { intent, content: CATALOG_NOT_READY_MESSAGE };
    }

    const registry = new ToolRegistry();
    registry.register(spec.definition, spec.handler);

    const extractionPrompt = pageContextNote ? `${spec.extractionPrompt}\n\n${pageContextNote}` : spec.extractionPrompt;

    let toolCallArguments: Record<string, unknown> | undefined;
    try {
      const extraction = await this.gateway.callTools({
        messages: [
          { role: 'system', content: extractionPrompt },
          ...input.history.slice(-4),
          { role: 'user', content: input.userMessage },
        ],
        tools: registry.getDefinitions([spec.name]),
        // Igual que en el Intent Router: DeepSeek gasta tokens de
        // razonamiento antes del tool call, un tope bajo corta la
        // respuesta antes de emitirlo y la extraccion siempre queda vacia.
        maxTokens: 300,
      });
      toolCallArguments = extraction.toolCalls[0]?.arguments;
    } catch {
      // sigue abajo con toolCallArguments sin definir -> mensaje honesto
    }

    if (!toolCallArguments) {
      await this.registerUnmetDemand(intent, input);
      return { intent, content: CATALOG_EXTRACTION_FAILED_MESSAGE };
    }

    // Pedido explicito del usuario: el agente debe ser "un verdadero
    // asesor" de regalos, nunca recomendar a ciegas sin saber para quien
    // es. Si la extraccion no logro inferir genero NI edad de la
    // conversacion, se pregunta en vez de adivinar — sin gastar la
    // busqueda ni la segunda llamada de generacion.
    if (intent === 'GIFT_RECOMMENDATION' && needsMoreGiftInfo(toolCallArguments as Partial<RecommendGiftArgs>)) {
      return { intent, content: buildGiftClarifyingQuestion(toolCallArguments as Partial<RecommendGiftArgs>) };
    }

    let toolResult: unknown;
    try {
      toolResult = await registry.execute({ name: spec.name, arguments: toolCallArguments });
    } catch {
      await this.registerUnmetDemand(intent, input);
      return { intent, content: CATALOG_EXTRACTION_FAILED_MESSAGE };
    }

    if (isEmptyCatalogResult(toolResult)) {
      await this.registerUnmetDemand(intent, input);
    }

    const draft = await this.gateway.generate({
      messages: [
        { role: 'system', content: CATALOG_RESPONSE_PROMPT },
        { role: 'user', content: input.userMessage },
        {
          role: 'system',
          content: `Resultado real del catalogo (JSON, unica fuente de verdad — no agregues nada que no este aqui):\n${JSON.stringify(toolResult)}`,
        },
      ],
      maxTokens: input.maxTokens,
    });

    return {
      intent,
      content: draft.content?.trim() || 'No tengo una respuesta clara para eso en este momento.',
      products: extractProductsForCards(toolResult),
    };
  }

  /**
   * Extrae categoria/marca/presupuesto via un tool call del LLM contra un
   * ToolRegistry propio de esta llamada (el handler necesita el mensaje/
   * intencion/conversacion de este turno, asi que el registro se crea aqui
   * en vez de ser un singleton compartido) y guarda el registro —
   * best-effort: si el LLM no esta configurado o la extraccion falla, igual
   * se guarda la demanda con esos campos en null en vez de perder el dato de
   * que hubo una busqueda que no pudimos resolver.
   */
  private async registerUnmetDemand(intent: Intent, input: RunAgentInput): Promise<void> {
    const registry = new ToolRegistry();
    registry.register(
      registerUnmetDemandToolDefinition,
      createRegisterUnmetDemandHandler({
        query: input.userMessage,
        normalizedIntent: intent,
        conversationId: input.conversationId,
      }),
    );

    let toolCallArguments: Record<string, unknown> = {};
    try {
      const result = await this.gateway.callTools({
        messages: [
          { role: 'system', content: EXTRACT_UNMET_DEMAND_PROMPT },
          { role: 'user', content: input.userMessage },
        ],
        tools: registry.getDefinitions([REGISTER_UNMET_DEMAND_TOOL_NAME]),
        maxTokens: 300,
      });
      toolCallArguments = result.toolCalls[0]?.arguments ?? {};
    } catch {
      // La extraccion es un extra — si falla, igual se registra la demanda sin esos datos.
    }

    try {
      await registry.execute({ name: REGISTER_UNMET_DEMAND_TOOL_NAME, arguments: toolCallArguments });
    } catch {
      // Nunca debe romper la respuesta al usuario por un fallo al registrar analitica.
    }
  }
}

function buildPageContextNote(product: ProductSummary): string {
  const price = formatCOP(product.price);
  const status = product.isActive ? `precio ${price}` : `ya no esta disponible (antes ${price})`;
  return `Contexto de pagina: el usuario esta viendo ahora mismo la ficha de "${product.name}" (${status}). Si dice "esto", "este producto" u otra referencia ambigua sin nombrarlo, se refiere a este — no le pidas que lo repita.`;
}

function isEmptyCatalogResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') {
    return true;
  }
  const obj = result as Record<string, unknown>;
  if ('count' in obj) {
    return obj.count === 0;
  }
  if ('found' in obj) {
    if (typeof obj.found === 'boolean') {
      return !obj.found;
    }
    if (Array.isArray(obj.found)) {
      return obj.found.length === 0;
    }
  }
  return false;
}

const MAX_CARDS = 5;

/**
 * Cada tool de catalogo devuelve su resultado con una forma distinta
 * (`products`, `recommendations[].product`, `product` singular, o
 * `found[]`) — se normaliza aqui a una sola lista de productos para las
 * cards, en vez de que cada tool tenga que saber sobre "cards".
 */
function extractProductsForCards(result: unknown): ProductSummary[] | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const obj = result as Record<string, unknown>;

  if (Array.isArray(obj.products)) {
    return (obj.products as ProductSummary[]).slice(0, MAX_CARDS);
  }
  if (Array.isArray(obj.recommendations)) {
    return (obj.recommendations as Array<{ product: ProductSummary }>).map((r) => r.product).slice(0, MAX_CARDS);
  }
  if (obj.product && typeof obj.product === 'object') {
    return [obj.product as ProductSummary];
  }
  if (Array.isArray(obj.found) && obj.found.every((item) => item && typeof item === 'object' && 'price' in item)) {
    return (obj.found as ProductSummary[]).slice(0, MAX_CARDS);
  }
  return undefined;
}
