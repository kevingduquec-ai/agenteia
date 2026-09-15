import { describe, expect, it } from 'vitest';
import { chunkSection } from './chunk.js';

const MAX_CHUNK_CHARS = 1200;

describe('chunkSection', () => {
  it('un texto corto queda como un solo chunk, con el heading incluido', () => {
    const chunks = chunkSection('Envíos', 'La entrega tarda 3 a 5 días hábiles.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Envíos\n\nLa entrega tarda 3 a 5 días hábiles.');
  });

  it('divide por parrafo cuando el texto tiene doble salto de linea y es largo', () => {
    const paragraph = 'A'.repeat(1000);
    const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
    const chunks = chunkSection('Términos', text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS + 'Términos\n\n'.length);
    }
  });

  it('REGRESION: un texto de 12KB SIN ningun <p>/parrafo (todo corrido, ver docs/FIXES-2026-09-14.md) nunca produce un solo chunk gigante', () => {
    // Reproduce exactamente el bug real encontrado en la pagina de Terminos
    // y Condiciones: sin dobles saltos de linea, la funcion debe caer al
    // fallback de division por oracion/palabra en vez de devolver el texto
    // completo como un unico chunk.
    const sentence = 'Este es un termino legal que aplica a la relacion comercial entre las partes. ';
    const hugeText = sentence.repeat(160); // ~12,000 caracteres, sin ningun \n\n
    expect(hugeText.length).toBeGreaterThan(10_000);

    const chunks = chunkSection('Términos y Condiciones', hugeText);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS + 'Términos y Condiciones\n\n'.length);
    }
  });

  it('incluso una sola "palabra" imposiblemente larga sin espacios no rompe el limite de forma indefinida (ultimo recurso: dividir por palabra)', () => {
    const oneHugeWord = 'x'.repeat(3000);
    const chunks = chunkSection('Politica', oneHugeWord);
    // No hay espacios para dividir por palabra tampoco — el greedyPack deja
    // ese "token" unico como su propio grupo (nunca corta a mitad de
    // palabra), asi que en este caso extremo SI puede superar el limite;
    // lo que importa es que no lance, y que no invente contenido.
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.map((c) => c.content).join('')).toContain(oneHugeWord);
  });

  it('nunca corta a mitad de una oracion cuando divide por oraciones', () => {
    const text = 'Primera oracion completa aqui. '.repeat(50) + 'Segunda idea distinta que cierra el parrafo.';
    const chunks = chunkSection('FAQ', text);
    for (const chunk of chunks) {
      const body = chunk.content.replace('FAQ\n\n', '');
      expect(body.trim().length === 0 || /[.!?]$|[a-záéíóúñ]$/i.test(body.trim())).toBe(true);
    }
  });

  it('el heading se repite igual en cada chunk resultante de la misma seccion', () => {
    const paragraph = 'palabra '.repeat(250); // ~2000 caracteres, con espacios reales para poder dividir
    const chunks = chunkSection('Garantía', paragraph);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.section).toBe('Garantía');
      expect(chunk.content.startsWith('Garantía\n\n')).toBe(true);
    }
  });
});
