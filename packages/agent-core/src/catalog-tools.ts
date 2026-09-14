import type { ToolDefinition } from '@prefiero-ia/llm';
import type { Intent } from './intent.js';
import type { ToolHandler } from './tool-registry.js';
import type { EmbedFn } from './semantic-candidates.js';
import { compareProductsHandler, compareProductsToolDefinition, COMPARE_PRODUCTS_TOOL_NAME } from './tools/compare-products.tool.js';
import {
  findCheaperAlternativesHandler,
  findCheaperAlternativesToolDefinition,
  FIND_CHEAPER_ALTERNATIVES_TOOL_NAME,
} from './tools/find-cheaper-alternatives.tool.js';
import {
  findProductsByBudgetHandler,
  findProductsByBudgetToolDefinition,
  FIND_PRODUCTS_BY_BUDGET_TOOL_NAME,
} from './tools/find-products-by-budget.tool.js';
import {
  findProductsByInstallmentHandler,
  findProductsByInstallmentToolDefinition,
  FIND_PRODUCTS_BY_INSTALLMENT_TOOL_NAME,
} from './tools/find-products-by-installment.tool.js';
import {
  findSimilarProductsHandler,
  findSimilarProductsToolDefinition,
  FIND_SIMILAR_PRODUCTS_TOOL_NAME,
} from './tools/find-similar-products.tool.js';
import { getProductHandler, getProductToolDefinition, GET_PRODUCT_TOOL_NAME } from './tools/get-product.tool.js';
import { createRecommendGiftHandler, recommendGiftToolDefinition, RECOMMEND_GIFT_TOOL_NAME } from './tools/recommend-gift.tool.js';
import {
  createRecommendProductsHandler,
  recommendProductsToolDefinition,
  RECOMMEND_PRODUCTS_TOOL_NAME,
} from './tools/recommend-products.tool.js';
import { searchProductsHandler, searchProductsToolDefinition, SEARCH_PRODUCTS_TOOL_NAME } from './tools/search-products.tool.js';

export interface CatalogToolSpec {
  name: string;
  definition: ToolDefinition;
  // Cada handler concreto tipa sus propios argumentos (algunos con campos
  // requeridos) — `any` aqui es deliberado: el registro solo puede
  // garantizar en tiempo de ejecucion que le llegue "lo que el LLM
  // devolvio", nunca la forma exacta, y cada handler ya maneja con
  // gracia un campo ausente (ver comentarios en tools/*.tool.ts).
  handler: ToolHandler<any>;
  /** Prompt de sistema para el paso de extraccion — le pide al LLM llamar SIEMPRE a esta tool con lo que pueda extraer del mensaje, nunca redactar texto directamente. */
  extractionPrompt: string;
}

/**
 * Un tool por cada intencion dependiente de catalogo (sección 28-30) — Fase
 * 5. Es una funcion (no un objeto estatico) porque `recommend_products` y
 * `recommend_gift` necesitan el proveedor de embeddings del llamador
 * (`AgentEngine`, inyectado en su constructor) para poder complementar la
 * busqueda literal con busqueda semantica — ver `semantic-candidates.ts`.
 * Las demas tools no lo necesitan (sus criterios ya son estructurados:
 * nombre exacto, presupuesto, cuota) y siguen siendo funciones estaticas.
 */
export function buildCatalogToolByIntent(embed?: EmbedFn): Partial<Record<Intent, CatalogToolSpec>> {
  return {
    PRODUCT_SEARCH: {
      name: SEARCH_PRODUCTS_TOOL_NAME,
      definition: searchProductsToolDefinition,
      handler: searchProductsHandler,
      extractionPrompt: 'Extrae del mensaje que producto busca el usuario y, si los menciona, categoria/marca/precio maximo. Llama siempre a la tool.',
    },
    BUDGET_SEARCH: {
      name: FIND_PRODUCTS_BY_BUDGET_TOOL_NAME,
      definition: findProductsByBudgetToolDefinition,
      handler: findProductsByBudgetHandler,
      extractionPrompt: 'Extrae del mensaje el presupuesto total en COP y que tipo de producto busca. Llama siempre a la tool.',
    },
    INSTALLMENT_SEARCH: {
      name: FIND_PRODUCTS_BY_INSTALLMENT_TOOL_NAME,
      definition: findProductsByInstallmentToolDefinition,
      handler: findProductsByInstallmentHandler,
      extractionPrompt: 'Extrae del mensaje la cuota mensual maxima en COP que puede pagar y que tipo de producto busca. Llama siempre a la tool.',
    },
    PRODUCT_COMPARISON: {
      name: COMPARE_PRODUCTS_TOOL_NAME,
      definition: compareProductsToolDefinition,
      handler: compareProductsHandler,
      extractionPrompt: 'Extrae del mensaje los nombres de los productos que el usuario quiere comparar (dos o mas). Llama siempre a la tool.',
    },
    PRODUCT_QUESTION: {
      name: GET_PRODUCT_TOOL_NAME,
      definition: getProductToolDefinition,
      handler: getProductHandler,
      extractionPrompt: 'Extrae del mensaje el nombre del producto especifico sobre el que pregunta. Llama siempre a la tool.',
    },
    PRODUCT_RECOMMENDATION: {
      name: RECOMMEND_PRODUCTS_TOOL_NAME,
      definition: recommendProductsToolDefinition,
      handler: createRecommendProductsHandler(embed),
      extractionPrompt: 'Extrae del mensaje que necesita el usuario y, si los menciona, presupuesto/cuota/categoria. Llama siempre a la tool.',
    },
    SIMILAR_PRODUCT: {
      name: FIND_SIMILAR_PRODUCTS_TOOL_NAME,
      definition: findSimilarProductsToolDefinition,
      handler: findSimilarProductsHandler,
      extractionPrompt: 'Extrae del mensaje el nombre del producto al que quiere ver parecidos. Llama siempre a la tool.',
    },
    CHEAPER_ALTERNATIVE: {
      name: FIND_CHEAPER_ALTERNATIVES_TOOL_NAME,
      definition: findCheaperAlternativesToolDefinition,
      handler: findCheaperAlternativesHandler,
      extractionPrompt: 'Extrae del mensaje el nombre del producto al que quiere una alternativa mas economica. Llama siempre a la tool.',
    },
    GIFT_RECOMMENDATION: {
      name: RECOMMEND_GIFT_TOOL_NAME,
      definition: recommendGiftToolDefinition,
      handler: createRecommendGiftHandler(embed),
      extractionPrompt:
        'Extrae del mensaje para quien es el regalo (recipientDescription), que le gusta o para que ocasion es (interests) si lo menciona, y el presupuesto si lo menciona. Infiere recipientGender y recipientAge de pistas del mensaje o de la conversacion previa (ej. "mi papa" = hombre, "mi novia de 25 anos" = mujer y 25, "mi bebe" = bebe, "mi perro"/"mi gata" = mascota) — dejalos vacios solo si de verdad no hay ninguna pista. No inventes "interests" si el mensaje no da ninguna pista real (ej. "mi hermana, tiene 25 años" no dice que le gusta) — dejalo vacio y la tool se encarga de preguntar. Llama siempre a la tool.',
    },
  };
}
