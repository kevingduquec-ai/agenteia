import * as cheerio from 'cheerio';

export interface KnowledgeSection {
  heading: string;
  text: string;
}

export interface KnowledgePage {
  title: string;
  sections: KnowledgeSection[];
}

const HEADING_LEVELS = ['h2', 'h3', 'h4', 'h5', 'h6'] as const;

/**
 * Parser generico para paginas institucionales tipo CMS: un titulo (<h1>)
 * y varias secciones marcadas por encabezados con contenido enriquecido
 * despues de cada uno. Sirve tanto para prefieroacr.com (Next.js, usa
 * <h2>) como para creditoacr.com (WordPress/Elementor, usa <h3> y tiene
 * varios <h1> vacios decorativos) — el nivel de encabezado se detecta
 * automaticamente en vez de asumir uno fijo.
 *
 * Next.js a veces "pospone" ese contenido dentro de un
 * `<div hidden id="S:N">` que un script mueve a `<main>` en el cliente —
 * el HTML del servidor ya trae todo el texto, solo hay que buscarlo ahi en
 * vez de en `<main>` (que en ese caso solo tiene un esqueleto de carga).
 */
export function parseKnowledgePage(html: string): KnowledgePage {
  const $ = cheerio.load(html);
  // El menu principal y el pie de pagina se repiten (a veces varias veces,
  // una copia por breakpoint desktop/tablet/movil) en TODAS las paginas —
  // sin esto contaminan el fallback de "cuerpo completo" con puro texto de
  // navegacion en vez del contenido real de la pagina.
  $('header, footer, nav').remove();
  const postponed = $('div[hidden]').filter((_, el) => HEADING_LEVELS.some((level) => $(el).find(level).length > 0)).first();
  const scope = postponed.length > 0 ? postponed : $('main').length > 0 ? $('main') : $('body');

  const title = firstNonEmptyText($, scope.find('h1')) || firstNonEmptyText($, $('h1')) || $('title').text().trim();

  // No basta con el primer nivel que tenga algun encabezado no vacio:
  // algunas paginas (Elementor) usan <h2> solo para titulos decorativos
  // partidos en varias etiquetas ("Nuestros" / "Canales" / "De pago") y
  // dejan el contenido real bajo <h5> mas abajo. Por eso se prueban todos
  // los niveles y se elige el que capture mas texto de seccion en total.
  //
  // Ademas, en tarjetas tipo Elementor el encabezado y su contenido no son
  // hermanos directos (hay un <div> con el logo/icono entre ellos): ambos
  // cuelgan de un <section> comun. Por eso cada nivel se prueba con dos
  // estrategias — hermanos directos y ancestro <section> comun — y se usa
  // la que capture mas texto.
  let sections: KnowledgeSection[] = [];
  let bestLength = 0;

  for (const level of HEADING_LEVELS) {
    const candidates = [extractSectionsBySiblings($, scope, level), extractSectionsBySectionAncestor($, scope, level)];
    for (const candidate of candidates) {
      const length = candidate.reduce((sum, s) => sum + s.text.length, 0);
      if (length > bestLength) {
        bestLength = length;
        sections = candidate;
      }
    }
  }

  // Paginas sin ningun encabezado de seccion (ej. una politica larga en un
  // solo bloque de texto): se trata todo el cuerpo como una sola seccion,
  // el chunker se encarga de dividirla despues por parrafo/oracion.
  if (sections.length === 0) {
    const wholeBodyText = richTextToPlainText($, scope);
    if (wholeBodyText) {
      sections.push({ heading: title, text: wholeBodyText });
    }
  }

  return { title, sections };
}

function extractSectionsBySiblings(
  $: cheerio.CheerioAPI,
  scope: cheerio.Cheerio<any>,
  headingLevel: (typeof HEADING_LEVELS)[number],
): KnowledgeSection[] {
  const sections: KnowledgeSection[] = [];

  scope.find(headingLevel).each((_, heading) => {
    const headingText = $(heading).text().trim();
    if (!headingText) return;

    const parts: string[] = [];
    let node = $(heading).next();
    while (node.length > 0 && !node.is(headingLevel)) {
      const text = richTextToPlainText($, node);
      if (text) {
        parts.push(text);
      }
      node = node.next();
    }

    const text = parts.join('\n\n').trim();
    if (text) {
      sections.push({ heading: headingText, text });
    }
  });

  return sections;
}

/**
 * Estrategia alterna para tarjetas Elementor donde el encabezado y su
 * contenido no son hermanos: ambos cuelgan de un <section> comun (ej. el
 * logo/icono queda entre medio). Agrupa los encabezados que comparten el
 * mismo <section> ancestro y usa el texto restante de ese <section> (sin
 * los propios encabezados) como contenido.
 */
function extractSectionsBySectionAncestor(
  $: cheerio.CheerioAPI,
  scope: cheerio.Cheerio<any>,
  headingLevel: (typeof HEADING_LEVELS)[number],
): KnowledgeSection[] {
  const order: any[] = [];
  const groups = new Map<any, string[]>();

  scope.find(headingLevel).each((_, heading) => {
    const headingText = $(heading).text().trim();
    if (!headingText) return;

    const ancestor = $(heading).closest('section').get(0);
    if (!ancestor) return;

    if (!groups.has(ancestor)) {
      groups.set(ancestor, []);
      order.push(ancestor);
    }
    groups.get(ancestor)!.push(headingText);
  });

  const sections: KnowledgeSection[] = [];
  for (const ancestor of order) {
    const clone = $(ancestor).clone();
    clone.find(headingLevel).remove();
    const text = richTextToPlainText($, clone);
    if (text) {
      sections.push({ heading: groups.get(ancestor)!.join(' '), text });
    }
  }

  return sections;
}

function firstNonEmptyText($: cheerio.CheerioAPI, elements: cheerio.Cheerio<any>): string {
  for (const el of elements.toArray()) {
    const text = $(el).text().trim();
    if (text) return text;
  }
  return '';
}

/**
 * Convierte un bloque de HTML enriquecido a texto plano legible: quita
 * <style>/<script> (Cheerio los incluye en `.text()`, a diferencia de un
 * navegador) y respeta los saltos de parrafo y de item de lista en vez de
 * pegar todo en una sola linea.
 */
function richTextToPlainText($: cheerio.CheerioAPI, container: cheerio.Cheerio<any>): string {
  const clone = container.clone();
  clone.find('script, style, noscript').remove();
  clone.find('br').replaceWith('\n');

  // Algunas paginas (ej. terminos y condiciones) no envuelven cada parrafo
  // en <p>: es un solo bloque de texto con <br> sueltos. Por eso se toman
  // los elementos "hoja" (sin otro p/li/div anidado) en vez de solo p/li —
  // así no se pierde contenido ni se duplica texto de un div que ya
  // contiene sus propios <p>.
  const candidates = clone.find('p, li, div');
  const leaves = candidates.filter((_, el) => $(el).find('p, li, div').length === 0);
  const blocks = leaves.length > 0 ? leaves : clone;

  const lines: string[] = [];
  blocks.each((_, el) => {
    const rawText = $(el).text();
    for (const line of rawText.split('\n')) {
      const text = line.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      lines.push(el.tagName?.toLowerCase() === 'li' ? `• ${text}` : text);
    }
  });

  return lines.join('\n\n');
}
