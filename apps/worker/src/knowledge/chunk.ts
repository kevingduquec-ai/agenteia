const MAX_CHUNK_CHARS = 1200;

export interface KnowledgeChunk {
  section: string;
  content: string;
}

/**
 * Cada seccion (pregunta+respuesta o bloque de politica) es ya un chunk
 * ideal para RAG. Si es larga se divide por parrafo; si un "parrafo" en si
 * mismo sigue siendo enorme (paginas legales que no usan <p> por bloque y
 * llegan como un solo texto corrido) se sigue dividiendo por oracion y,
 * como ultimo recurso, por palabra — nunca se guarda un chunk gigante que
 * arruinaria la recuperacion semantica ni se corta a la mitad de una
 * palabra.
 */
export function chunkSection(heading: string, text: string): KnowledgeChunk[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces = (paragraphs.length > 0 ? paragraphs : [text.trim()]).flatMap((paragraph) =>
    splitLongText(paragraph, MAX_CHUNK_CHARS),
  );

  const groups = greedyPack(pieces, MAX_CHUNK_CHARS, '\n\n');

  return groups.map((group) => ({ section: heading, content: `${heading}\n\n${group}` }));
}

function splitLongText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const sentenceGroups = greedyPack(
    text.split(/(?<=[.!?])\s+/).filter(Boolean),
    maxChars,
    ' ',
  );

  return sentenceGroups.flatMap((group) =>
    group.length <= maxChars ? [group] : greedyPack(group.split(/\s+/).filter(Boolean), maxChars, ' '),
  );
}

/** Acumula tokens en grupos que no superen `maxChars`, uniendo con `joiner`. */
function greedyPack(tokens: string[], maxChars: number, joiner: string): string[] {
  const groups: string[] = [];
  let buffer = '';

  for (const token of tokens) {
    const candidate = buffer ? `${buffer}${joiner}${token}` : token;
    if (candidate.length > maxChars && buffer) {
      groups.push(buffer);
      buffer = token;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) {
    groups.push(buffer);
  }
  return groups;
}
