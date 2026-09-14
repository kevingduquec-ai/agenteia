import { searchProducts } from '@prefiero-ia/catalog';
import type { ToolDefinition } from '@prefiero-ia/llm';
import { MIN_SEMANTIC_SCORE_FOR_RELEVANCE, rankProducts, type RankingCandidate } from '@prefiero-ia/recommendation';
import type { ToolHandler } from '../tool-registry.js';
import { mergeSemanticCandidates, safeSemanticMatches, type EmbedFn } from '../semantic-candidates.js';
import type { RecommendProductsResult } from './recommend-products.tool.js';

export const RECOMMEND_GIFT_TOOL_NAME = 'recommend_gift';

export const recommendGiftToolDefinition: ToolDefinition = {
  name: RECOMMEND_GIFT_TOOL_NAME,
  description: 'Recomienda productos del catalogo como regalo segun para quien es y su presupuesto.',
  parameters: {
    type: 'object',
    properties: {
      recipientDescription: { type: 'string', description: 'Para quien es el regalo, en una frase breve (ej. "mi hermano de 20 anos").' },
      interests: {
        type: 'string',
        description:
          'Que le gusta, su hobby, o para que ocasion es el regalo — esto es lo que se usa para buscar en el catalogo (ej. "maquillaje", "tecnologia", "hacer ejercicio", "cumpleanos"). Omitir si el mensaje no da ninguna pista todavia.',
      },
      recipientGender: {
        type: 'string',
        enum: ['hombre', 'mujer', 'bebe', 'mascota', 'unisex'],
        description:
          'Para quien es el regalo, si se puede inferir del mensaje (ej. "mi papa"/"mi novio" = hombre, "mi mama"/"mi novia" = mujer, "mi bebe"/"mi sobrino recien nacido" = bebe, "mi perro"/"mi gata" = mascota, "mi amigue"/algo neutro = unisex). Omitir si no hay ninguna pista.',
      },
      recipientAge: { type: 'number', description: 'Edad aproximada del destinatario en anos, si se menciona o se puede inferir (ej. "mi abuela" ~ 70). Omitir si no hay ninguna pista.' },
      budget: { type: 'number', description: 'Presupuesto en COP, si lo menciona. Omitir si no.' },
      categoryName: { type: 'string', description: 'Categoria mencionada, si aplica. Omitir si no.' },
    },
    required: ['recipientDescription'],
  },
};

export interface RecommendGiftArgs {
  recipientDescription: string;
  interests?: string;
  recipientGender?: 'hombre' | 'mujer' | 'bebe' | 'mascota' | 'unisex';
  recipientAge?: number;
  budget?: number;
  categoryName?: string;
}

type GiftGateArgs = Pick<RecommendGiftArgs, 'recipientGender' | 'recipientAge' | 'interests' | 'categoryName'>;

/**
 * Pedido explicito del usuario: el agente debe ser "un verdadero asesor",
 * nunca recomendar un regalo a ciegas. Se exigen dos cosas antes de buscar:
 * saber quien es el destinatario (genero o edad — sin esto ni un perfume se
 * puede acertar) Y saber que buscar (interests o categoryName — sin esto la
 * busqueda usaria la descripcion de la PERSONA como texto de busqueda, que
 * nunca coincide con nada del catalogo y termina en "no encontré productos"
 * — bug real encontrado en pruebas: "es para mi hermana, tiene 25 años" no
 * trae resultados porque "hermana"/"años" no son palabras de producto).
 */
export function needsMoreGiftInfo(args: GiftGateArgs): boolean {
  const hasWho = !!args.recipientGender || args.recipientAge !== undefined;
  const hasWhat = !!args.interests || !!args.categoryName;
  return !hasWho || !hasWhat;
}

/**
 * El tono importa: el agente pregunta como lo haria un asesor que ya sabe
 * lo que hace, no como un modelo dudando si va a acertar. Nunca frases como
 * "para que sí acierte" — eso expone la incertidumbre interna al comprador.
 */
export function buildGiftClarifyingQuestion(args: GiftGateArgs): string {
  const hasGender = !!args.recipientGender;
  const hasAge = args.recipientAge !== undefined;
  const hasWho = hasGender || hasAge;
  const hasWhat = !!args.interests || !!args.categoryName;

  if (!hasWho && !hasWhat) {
    return '¿Para quién es el regalo — un hombre, una mujer, un bebé o una mascota? Y cuéntame qué le gusta o para qué ocasión es, así te muestro justo lo que va a gustar.';
  }
  if (!hasWho) {
    return '¿Y el regalo es para un hombre, una mujer, un bebé o una mascota?';
  }
  if (!hasWhat) {
    return '¿Qué le gusta o para qué ocasión es el regalo? Así te muestro opciones que sí le van a servir.';
  }
  if (!hasGender) {
    return '¿El regalo es para un hombre, una mujer, un bebé o una mascota?';
  }
  return '¿Qué edad tiene aproximadamente?';
}

/**
 * Mismo motor de ranking que recommend_products (sección 31-32) — un regalo
 * es, para efectos del catalogo, una busqueda con `need` = lo que le gusta
 * al destinatario (`interests`), NUNCA la descripcion de la persona en si
 * (`recipientDescription`) — "mi hermana de 25 años" no tiene ni una palabra
 * que pueda coincidir con un producto. `embed` opcional: ver
 * `createRecommendProductsHandler`.
 */
export function createRecommendGiftHandler(embed?: EmbedFn): ToolHandler<RecommendGiftArgs, RecommendProductsResult> {
  return async (args) => {
    const searchText = args.interests ?? args.recipientDescription;
    const [literalCandidates, semanticMatches] = await Promise.all([
      searchProducts({ text: searchText, categoryName: args.categoryName, maxPrice: args.budget, limit: 20 }),
      safeSemanticMatches(searchText, embed),
    ]);

    const candidates: RankingCandidate[] = mergeSemanticCandidates(literalCandidates, semanticMatches);
    const ranked = rankProducts({ need: searchText, budget: args.budget }, candidates);

    // Sin esto, un candidato que solo entro por una palabra de marketing
    // generica en su descripcion (ej. "tecnologia" en un blanqueador dental)
    // rellenaba igual el cupo de 5 aunque no tuviera nada que ver con lo
    // pedido — bug real encontrado en pruebas ("regalo de tecnologia" traia
    // bombillos y blanqueador dental). Mejor menos resultados que ruido.
    const relevant = ranked.filter((r) => r.needMatch > 0 || r.semanticSimilarity >= MIN_SEMANTIC_SCORE_FOR_RELEVANCE);

    const top = relevant.slice(0, 5);
    return {
      count: top.length,
      recommendations: top.map(({ product, reasons }) => ({ product, reasons })),
    };
  };
}
