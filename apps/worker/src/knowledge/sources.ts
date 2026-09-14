import { FREQUENT_QUESTIONS_API_HEADERS, FREQUENT_QUESTIONS_API_URL } from './accordion-parser.js';

export type KnowledgeSourceKind = 'heading' | 'frequent-questions-api';

export interface KnowledgeSource {
  url: string;
  kind: KnowledgeSourceKind;
  /** URL a guardar como source_url del documento — solo difiere de `url` cuando `url` es un endpoint de API. */
  sourceUrl?: string;
  headers?: Record<string, string>;
}

/**
 * Paginas institucionales publicas reales — no son URLs inventadas, se
 * descubrieron navegando el footer/menu de cada sitio. Ninguna esta en el
 * Disallow de su robots.txt.
 */
export const KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  // prefieroacr.com — el marketplace (Next.js, secciones con <h2>)
  { url: 'https://prefieroacr.com/preguntas-frecuentes', kind: 'heading' },
  { url: 'https://prefieroacr.com/quien-es-prefiero', kind: 'heading' },
  { url: 'https://prefieroacr.com/solicitar-credito', kind: 'heading' },
  { url: 'https://prefieroacr.com/terminos-y-condiciones-de-uso', kind: 'heading' },
  { url: 'https://prefieroacr.com/politica-de-envio-despacho-y-entrega', kind: 'heading' },
  { url: 'https://prefieroacr.com/politica-de-cambios-devoluciones-y-derecho-de-retracto', kind: 'heading' },
  { url: 'https://prefieroacr.com/politica-cookies', kind: 'heading' },
  { url: 'https://prefieroacr.com/politicas-de-privacidad', kind: 'heading' },
  { url: 'https://prefieroacr.com/cuidamos-tus-datos', kind: 'heading' },
  { url: 'https://prefieroacr.com/ofertas-y-promociones', kind: 'heading' },

  // creditoacr.com — el crédito ACR+ en si (WordPress/Elementor, <h3>).
  // Se dejaron fuera a proposito: /simulador-de-credito/ y /mi-cuota/
  // (son widgets interactivos sin texto estatico), /boton-de-pagos/ y
  // /aliados/ (contenido para comercios, no para el comprador final),
  // /app-movil/ (solo enlaces a las tiendas de apps) y /referidos/ (una
  // promocion con fecha de vigencia — se volveria informacion vieja).
  { url: 'https://creditoacr.com/conocenos/', kind: 'heading' },
  { url: 'https://creditoacr.com/corresponsales-de-pago/', kind: 'heading' },
  { url: 'https://creditoacr.com/politicas-de-privacidad/', kind: 'heading' },
  // Las 13 preguntas frecuentes de /contacto/ las arma el navegador por
  // JS a partir de esta API — un fetch plano de la pagina no trae nada,
  // asi que se consume la API directamente (ver accordion-parser.ts).
  {
    url: FREQUENT_QUESTIONS_API_URL,
    kind: 'frequent-questions-api',
    sourceUrl: 'https://creditoacr.com/contacto/',
    headers: FREQUENT_QUESTIONS_API_HEADERS,
  },
];
