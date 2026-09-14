import type { CheerioAPI } from 'cheerio';

/**
 * Next.js App Router incrusta el arbol de React Server Components como una
 * serie de <script>self.__next_f.push([1,"<id>:<json>"])</script>. Ahi
 * viaja, sin transformar, el objeto completo que el backend de ACR+ le
 * entrega al componente de producto (precio, categoria, vendedor, specs) —
 * mucho mas rico y estable que intentar leer clases de Tailwind del DOM.
 * Esta funcion extrae cada chunk, lo parsea como JSON generico y devuelve
 * la lista de valores parseados para que el caller busque lo que necesita.
 */
export function extractNextFlightValues($: CheerioAPI): unknown[] {
  const values: unknown[] = [];

  $('script').each((_, el) => {
    const text = $(el).contents().text();
    if (!text.includes('self.__next_f.push(')) {
      return;
    }

    let searchFrom = 0;
    for (;;) {
      const pushStart = text.indexOf('self.__next_f.push(', searchFrom);
      if (pushStart === -1) break;
      const arrayStart = text.indexOf('[', pushStart);
      if (arrayStart === -1) break;

      const arrayLiteral = extractBalanced(text, arrayStart, '[', ']');
      if (!arrayLiteral) break;
      searchFrom = arrayStart + arrayLiteral.length;

      const chunkText = parseChunkText(arrayLiteral);
      if (chunkText === null) continue;

      const withoutChunkId = chunkText.replace(/^[0-9a-f]+:/, '');
      const parsed = tryParseJson(withoutChunkId);
      if (parsed !== undefined) {
        values.push(parsed);
      }
    }
  });

  return values;
}

/** Busca en profundidad el primer objeto que cumpla el predicado dado. */
export function findInFlightValues<T>(values: unknown[], predicate: (value: unknown) => value is T, maxDepth = 15): T | null {
  for (const value of values) {
    const found = walk(value, predicate, maxDepth, 0);
    if (found) return found;
  }
  return null;
}

/**
 * Igual que `findInFlightValues` pero junta TODAS las coincidencias en vez
 * de detenerse en la primera — necesario para paginas de listado/categoria,
 * donde cada chunk trae muchas tarjetas de producto, no una sola ficha.
 */
export function findAllInFlightValues<T>(values: unknown[], predicate: (value: unknown) => value is T, maxDepth = 15): T[] {
  const results: T[] = [];
  for (const value of values) {
    walkAll(value, predicate, maxDepth, 0, results);
  }
  return results;
}

function walk<T>(value: unknown, predicate: (value: unknown) => value is T, maxDepth: number, depth: number): T | null {
  if (depth > maxDepth || value === null || typeof value !== 'object') {
    return null;
  }
  if (predicate(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walk(item, predicate, maxDepth, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const found = walk((value as Record<string, unknown>)[key], predicate, maxDepth, depth + 1);
    if (found) return found;
  }
  return null;
}

function walkAll<T>(value: unknown, predicate: (value: unknown) => value is T, maxDepth: number, depth: number, results: T[]): void {
  if (depth > maxDepth || value === null || typeof value !== 'object') {
    return;
  }
  if (predicate(value)) {
    results.push(value);
    // Una tarjeta de producto no anida OTRA tarjeta de producto adentro —
    // seguir bajando aqui solo arriesga falsos positivos en sub-objetos
    // (ej. "producto relacionado" con su propio sku).
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkAll(item, predicate, maxDepth, depth + 1, results);
    }
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    walkAll((value as Record<string, unknown>)[key], predicate, maxDepth, depth + 1, results);
  }
}

function parseChunkText(arrayLiteral: string): string | null {
  const parsed = tryParseJson(arrayLiteral);
  if (Array.isArray(parsed) && typeof parsed[1] === 'string') {
    return parsed[1];
  }
  return null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Extrae `text.slice(start, end+1)` balanceando corchetes y respetando strings/escapes. */
function extractBalanced(text: string, startIndex: number, openChar: string, closeChar: string): string | null {
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }
  return null;
}
