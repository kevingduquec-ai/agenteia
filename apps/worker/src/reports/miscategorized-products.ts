import { getPool } from '@prefiero-ia/database';

/**
 * Reporte de solo lectura (pedido explicito del usuario: "solo reportar,
 * no tocar codigo" — la categorizacion mala viene del propio sitio de
 * origen, no es algo que este crawler pueda corregir sin inventar una
 * taxonomia propia). Reusa los mismos grupos de sinonimos ya validados en
 * `product-search.repository.ts` (encontrados via pruebas reales de
 * busqueda) como señal de "de que categoria es este producto de verdad",
 * en vez de inventar un heuristico nuevo sin probar.
 *
 * Un producto es un "candidato a revisar" si su NOMBRE contiene una
 * palabra fuerte de un grupo (ej. "celular") pero su categoria asignada
 * no contiene ninguna palabra esperada de ese mismo grupo — la misma
 * distincion exacta que `unaccentCategoryExact` ya usa para ranking de
 * busqueda, aplicada aqui al reves para encontrar catalogacion sospechosa
 * en vez de para rankear resultados.
 */
interface CategorySignal {
  label: string;
  nameTerms: string[];
  categoryTerms: string[];
}

// "Portatil"/"computador"/"ordenador" quedan afuera a proposito: son el
// mismo falso positivo ya documentado en product-search.repository.ts
// ("'portatil' tambien es un adjetivo generico en español ['Batidor...
// Portatil A Bateria']") — un producto puede ser "portatil" (adjetivo,
// "que se puede llevar") sin ser un computador. Verificado en la primera
// corrida de este reporte: TODO el ruido de "Computadores/Portátiles"
// venia de "portatil" como adjetivo (Licuadora/Ducha/Consola/Sandwichera
// "Portátil"), nunca de "laptop"/"notebook" en solitario.
const SIGNALS: CategorySignal[] = [
  { label: 'Celulares', nameTerms: ['celular', 'telefono', 'smartphone'], categoryTerms: ['celular', 'telefono', 'movil', 'smartphone'] },
  { label: 'Computadores/Portátiles', nameTerms: ['laptop', 'notebook'], categoryTerms: ['computador', 'portatil', 'laptop', 'pc', 'ordenador'] },
  { label: 'Televisores', nameTerms: ['televisor', 'television'], categoryTerms: ['televisor', 'television', 'tv'] },
  { label: 'Neveras/Refrigeradores', nameTerms: ['nevera', 'refrigerador', 'frigorifico'], categoryTerms: ['nevera', 'refrigerador', 'frigorifico'] },
  {
    label: 'Parlantes/Audio',
    nameTerms: ['parlante', 'altavoz', 'corneta', 'bocina'],
    categoryTerms: ['parlante', 'altavoz', 'audio', 'sonido', 'bocina', 'corneta'],
  },
];

// Categorias que son legitimamente "accesorio para X" — un cargador o una
// funda "para celular" esta bien categorizado como Cargadores/Fundas, no
// como Celulares; sin esto, cualquier accesorio que mencione la palabra
// del producto principal en su propio nombre se marcaria como sospechoso.
const ACCESSORY_CATEGORY_TERMS = [
  'accesorio',
  'funda',
  'estuche',
  'cargador',
  'cable',
  'protector',
  'soporte',
  'bateria',
  'adaptador',
  'camara',
  'proyector',
];

// Un producto ofrecido junto a un regalo/combo ("+ PARLANTE...", "+
// OBSEQUIO...") menciona la categoria del REGALO en su propio nombre — la
// categoria asignada es la del producto principal, no la del obsequio.
function looksLikeBundleWithFreebie(name: string): boolean {
  return /\+/.test(name);
}

export interface MiscategorizedCandidate {
  productId: string;
  name: string;
  url: string;
  categoryName: string | null;
  matchedSignal: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Candidatos a revisar para UN tenant — nunca "errores confirmados": el
 * nombre real de un producto puede mencionar otra categoria de forma
 * legitima (ej. un cargador "compatible con tu celular" categorizado
 * correctamente como Accesorios). Sirve para que un humano (Qubit) los
 * revise y, si aplica, se los reporte a ACR+ — no para recategorizar nada
 * automaticamente.
 */
export async function findMiscategorizedCandidates(tenantId: string): Promise<MiscategorizedCandidate[]> {
  const pool = getPool();
  const result = await pool.query<{ id: string; name: string; url: string; category_name: string | null }>(
    `SELECT p.id, p.name, p.url, c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.tenant_id = $1 AND p.is_active`,
    [tenantId],
  );

  const candidates: MiscategorizedCandidate[] = [];
  for (const row of result.rows) {
    if (looksLikeBundleWithFreebie(row.name)) continue;

    const normalizedName = normalize(row.name);
    const normalizedCategory = normalize(row.category_name ?? '');
    if (ACCESSORY_CATEGORY_TERMS.some((term) => normalizedCategory.includes(term))) continue;

    for (const signal of SIGNALS) {
      const nameMatches = signal.nameTerms.some((term) => normalizedName.includes(term));
      if (!nameMatches) continue;

      const categoryMatches = signal.categoryTerms.some((term) => normalizedCategory.includes(term));
      if (!categoryMatches) {
        candidates.push({ productId: row.id, name: row.name, url: row.url, categoryName: row.category_name, matchedSignal: signal.label });
      }
      break; // una sola señal por producto — la primera que matcheo su nombre.
    }
  }
  return candidates;
}
