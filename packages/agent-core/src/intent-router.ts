import type { ChatMessage, LLMGateway } from '@prefiero-ia/llm';
import { INTENTS, isIntent, type Intent } from './intent.js';

const CLASSIFIER_SYSTEM_PROMPT = `Clasifica el ULTIMO mensaje del usuario en EXACTAMENTE una de estas categorias. Responde solo la palabra de la categoria, en mayusculas, sin explicacion, sin comillas, sin punto final.

Categorias: ${INTENTS.join(', ')}

Guia:
- FAQ: preguntas generales sobre Prefiero ACR+ ya cubiertas en preguntas frecuentes (como comprar, seguimiento de pedido, metodos de pago del marketplace).
- CREDIT_INFORMATION: preguntas sobre el credito ACR en si (cupo, como solicitarlo, canales de pago, convenios, cuotas).
- WARRANTY_INFORMATION: preguntas sobre garantia de productos.
- RETURN_INFORMATION: devoluciones, cambios, derecho de retracto.
- PRODUCT_SEARCH: quiere encontrar productos que cumplan un criterio (categoria, uso).
- PRODUCT_RECOMMENDATION: pide que le recomienden algo sin especificar producto exacto.
- PRODUCT_COMPARISON: quiere comparar dos o mas productos especificos.
- PRODUCT_QUESTION: pregunta un detalle de un producto especifico (precio, stock, caracteristicas).
- BUDGET_SEARCH: busca productos segun un presupuesto total.
- INSTALLMENT_SEARCH: busca productos segun el valor de la cuota que puede pagar.
- CHEAPER_ALTERNATIVE: pide una opcion mas economica que algo que ya vio.
- SIMILAR_PRODUCT: pide productos parecidos a uno que ya vio.
- GIFT_RECOMMENDATION: busca un regalo para alguien.
- HUMAN_SUPPORT: queja, reclamo, problema con un pedido, algo que requiere una persona real.
- PRIVATE_CUSTOMER_DATA: pide ver o cambiar datos personales o de cuenta (cupo exacto, historial de compras, datos de contacto).
- GENERAL_CHAT: saludo, agradecimiento, o charla que no encaja en nada de lo anterior pero sigue siendo sobre Prefiero ACR+ / Credito ACR.
- UNKNOWN: no tiene nada que ver con Prefiero ACR+ ni Credito ACR.`;

export interface ClassifyIntentInput {
  gateway: LLMGateway;
  message: string;
  history?: ChatMessage[];
  /** Nota corta si el usuario abrio el chat desde una ficha de producto (sección 33-34) — ayuda a clasificar bien referencias ambiguas como "esto"/"este producto". */
  pageContextNote?: string | null;
}

// DeepSeek V4 es un modelo de razonamiento: sus tokens de "pensamiento"
// interno cuentan contra maxTokens antes de emitir la palabra visible, asi
// que un tope bajo (ej. 20) corta la respuesta a "" (finishReason="length")
// y la clasificacion cae siempre al fallback GENERAL_CHAT. Se deja margen
// de sobra aunque la salida visible sea una sola palabra.
const CLASSIFIER_MAX_TOKENS = 300;

/**
 * Clasifica el mensaje del usuario en una de las intenciones de la sección
 * 28. Es una llamada al LLM aparte, deliberadamente barata (temperatura 0)
 * — si el LLM no esta configurado o responde algo que no es una categoria
 * valida, se degrada a GENERAL_CHAT en vez de fallar: la clasificacion es
 * una ayuda para decidir el flujo, nunca un bloqueo para responder.
 */
export async function classifyIntent({ gateway, message, history = [], pageContextNote }: ClassifyIntentInput): Promise<Intent> {
  try {
    const systemPrompt = pageContextNote ? `${CLASSIFIER_SYSTEM_PROMPT}\n\n${pageContextNote}` : CLASSIFIER_SYSTEM_PROMPT;
    const result = await gateway.generate({
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.slice(-4),
        { role: 'user', content: message },
      ],
      temperature: 0,
      maxTokens: CLASSIFIER_MAX_TOKENS,
    });
    const label = (result.content ?? '').trim().toUpperCase().replace(/[^A-Z_]/g, '');
    return isIntent(label) ? label : 'GENERAL_CHAT';
  } catch {
    return 'GENERAL_CHAT';
  }
}
