import * as cheerio from 'cheerio';
import type { KnowledgePage, KnowledgeSection } from './page-parser.js';

/**
 * creditoacr.com/contacto/ muestra un acordeon de 13 preguntas frecuentes,
 * pero lo arma enteramente por JavaScript en el navegador: pide los datos
 * a `https://desarrollos.aliadosacr.com/api/app/frequent_questions` y
 * construye el HTML del acordeon con la respuesta. Por eso un fetch plano
 * de la pagina (sin ejecutar JS) no trae ninguna pregunta. En vez de
 * depender de Playwright, se consume esa misma API JSON directamente —
 * es la fuente real de los datos, no una copia; el "Token-Client"/
 * "ID-Client" son las cabeceras que la propia pagina publica ya expone en
 * su JS a cualquier visitante (no son credenciales privadas).
 */
export const FREQUENT_QUESTIONS_API_URL = 'https://desarrollos.aliadosacr.com/api/app/frequent_questions';

export const FREQUENT_QUESTIONS_API_HEADERS = {
  'Token-Client': 'fdca1d0611e5969317cdbe0898a13537e9ada7c321330758e6b8d73752e56a14',
  'ID-Client': 'MQ==',
};

interface FrequentQuestionsApiResponse {
  success: boolean;
  data: Array<{ id: number; question: string; answer: string }>;
}

export function parseFrequentQuestionsApi(jsonText: string): KnowledgePage {
  const parsed = JSON.parse(jsonText) as FrequentQuestionsApiResponse;
  if (!parsed.success || !Array.isArray(parsed.data)) {
    return { title: 'Preguntas frecuentes — Crédito ACR', sections: [] };
  }

  const sections: KnowledgeSection[] = parsed.data
    .map((item): KnowledgeSection => ({
      heading: item.question.trim(),
      text: stripHtml(item.answer),
    }))
    .filter((section) => section.heading && section.text);

  return { title: 'Preguntas frecuentes — Crédito ACR', sections };
}

function stripHtml(html: string): string {
  return cheerio.load(html).text().replace(/\s+/g, ' ').trim();
}
