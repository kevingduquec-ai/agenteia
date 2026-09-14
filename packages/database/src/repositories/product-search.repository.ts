import { getPool } from '../pool.js';

export interface ProductRow {
  id: string;
  externalId: string;
  name: string;
  slug: string;
  description: string | null;
  url: string;
  imageUrl: string | null;
  brandName: string | null;
  categoryName: string | null;
  sellerName: string | null;
  price: number;
  originalPrice: number | null;
  discountPercentage: number | null;
  installmentValue: number | null;
  installmentCount: number | null;
  currency: string;
  isOffer: boolean;
  /** false si el harvester dejo de verlo en el sitio en la ultima cosecha completa (descontinuado) — ver `markStaleProductsInactive`. Los resolvers por id/nombre lo devuelven igual (para poder avisar "ya no esta disponible" en vez de fingir que sigue a la venta), pero `searchProducts` siempre filtra por activo. */
  isActive: boolean;
}

interface ProductRawRow {
  id: string;
  external_id: string;
  name: string;
  slug: string;
  description: string | null;
  url: string;
  image_url: string | null;
  brand_name: string | null;
  category_name: string | null;
  seller_name: string | null;
  price: string;
  original_price: string | null;
  discount_percentage: string | null;
  installment_value: string | null;
  installment_count: number | null;
  currency: string;
  is_offer: boolean;
  is_active: boolean;
}

const PRODUCT_SELECT = `
  SELECT p.id, p.external_id, p.name, p.slug, p.description, p.url, p.image_url,
         b.name AS brand_name, c.name AS category_name, s.name AS seller_name,
         p.price, p.original_price, p.discount_percentage,
         p.installment_value, p.installment_count, p.currency, p.is_offer, p.is_active
  FROM products p
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN sellers s ON s.id = p.seller_id
`;

/** `numeric`/`decimal` llegan como string del driver de pg (evita perder precision) — se convierten aqui, en el unico lugar que lee estas filas. */
function mapRow(row: ProductRawRow): ProductRow {
  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    url: row.url,
    imageUrl: row.image_url,
    brandName: row.brand_name,
    categoryName: row.category_name,
    sellerName: row.seller_name,
    price: Number(row.price),
    originalPrice: row.original_price === null ? null : Number(row.original_price),
    discountPercentage: row.discount_percentage === null ? null : Number(row.discount_percentage),
    installmentValue: row.installment_value === null ? null : Number(row.installment_value),
    installmentCount: row.installment_count,
    currency: row.currency,
    isOffer: row.is_offer,
    isActive: row.is_active,
  };
}

function synonymVariants(word: string): string[] {
  const normalized = word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return SEARCH_SYNONYMS[normalized] ?? [word];
}

/** ILIKE insensible a tildes en ambos lados — un comprador tipico escribe "audifonos" sin tilde y debe encontrar "Audífonos" igual. */
function unaccentIlike(column: string, paramIndex: number): string {
  return `unaccent(${column}) ILIKE unaccent($${paramIndex})`;
}

/**
 * Igualdad exacta (no substring) contra el nombre de categoria, probando
 * singular y plural. Existe porque una categoria real como "Celulares"
 * y una categoria de accesorios como "Accesorios para celulares" o
 * "Soportes para TV" contienen literalmente la MISMA palabra — un
 * substring match no puede distinguir "es un celular" de "es para un
 * celular", pero una igualdad exacta de categoria si: el producto cuya
 * categoria ES, palabra por palabra, "Celulares" es casi con certeza un
 * celular real, no un accesorio. Bug real encontrado en pruebas: "cel
 * bueno barato" solo traia fundas y cargadores porque "Accesorios para
 * celulares" matcheaba igual de "fuerte" que la categoria real.
 */
function unaccentCategoryExact(paramIndex: number): string {
  return `lower(unaccent(c.name)) = ANY($${paramIndex}::text[])`;
}

function exactFormsFor(variant: string): string[] {
  const bare = variant.endsWith('s') ? variant.slice(0, -1) : variant;
  return Array.from(new Set([variant, `${variant}s`, bare, `${bare}es`]));
}

export interface ProductSearchFilters {
  /** Palabras a buscar en nombre/descripcion/categoria/marca — cada palabra debe aparecer en al menos uno de esos campos (AND de OR, evita falsos positivos con una sola palabra generica). */
  text?: string;
  categoryName?: string;
  brandName?: string;
  minPrice?: number;
  maxPrice?: number;
  maxInstallment?: number;
  onlyOffers?: boolean;
  excludeProductId?: string;
  limit?: number;
}

// Palabras de relleno de una pregunta en lenguaje natural (verbos de
// busqueda, articulos, preposiciones) que nunca aparecen literalmente en
// un nombre/descripcion/categoria/marca de producto. Si se exige que
// TODAS las palabras de la consulta matcheen (AND), una consulta tan
// normal como "busco un celular samsung economico" no encuentra nada aunque
// "samsung"/"celular" si tengan resultados reales — el mismo error que ya
// se habia corregido en la busqueda de conocimiento (ver rag/search.ts).
const SPANISH_STOPWORDS = new Set([
  'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'de', 'del', 'al', 'a', 'en', 'y', 'o', 'u',
  'con', 'por', 'para', 'que', 'como', 'me', 'mi', 'mis', 'tu', 'tus', 'su', 'sus',
  'busco', 'buscar', 'buscando', 'quiero', 'quisiera', 'necesito', 'tienen', 'tienes', 'tengo', 'hay',
  'algo', 'alguna', 'algun', 'alguno', 'algunas', 'algunos', 'este', 'esta', 'esa', 'ese', 'esto', 'eso',
  // Verbos de relleno de frases como "que me sirva para..." — diluyen la
  // relevancia de las palabras que si importan sin aportar nada (nunca
  // aparecen como distintivo real de un producto).
  'sirva', 'sirve', 'servir', 'pueda', 'puede',
]);

// El catalogo usa un solo termino "oficial" por producto (ej. "Audífonos"),
// pero un comprador real en español latino escribe indistintamente
// cualquiera de sus sinonimos regionales. Sin esto, "auriculares" (muy
// comun) no encuentra nada aunque existan decenas de audifonos en stock —
// bug real encontrado en pruebas de texto libre. Cada palabra de busqueda
// se expande a su grupo antes de armar el OR, para que cualquier variante
// cuente como el mismo "acierto" (no infla el score de relevancia).
const SEARCH_SYNONYMS: Record<string, string[]> = {
  auriculares: ['audifono', 'auricular'],
  audifonos: ['audifono', 'auricular'],
  audifono: ['audifono', 'auricular'],
  celular: ['celular', 'telefono', 'movil'],
  celulares: ['celular', 'telefono', 'movil'],
  // "Cel"/"cels" — abreviatura de texto muy comun en Colombia
  // ("cel bueno barato"), nunca aparece asi en el catalogo pero el
  // comprador si escribe asi.
  cel: ['celular', 'telefono', 'movil'],
  cels: ['celular', 'telefono', 'movil'],
  telefono: ['telefono', 'celular', 'movil'],
  telefonos: ['telefono', 'celular', 'movil'],
  movil: ['movil', 'celular', 'telefono'],
  moviles: ['movil', 'celular', 'telefono'],
  // "Computador" para el catalogo real es una categoria de escritorio
  // separada de "Portátiles" — un comprador que dice "computador" casi
  // siempre acepta un portatil tambien. Bug real encontrado en pruebas:
  // "computador para jugar" no encontraba los portatiles gamer reales del
  // catalogo (LENOVO GAMING LOQ, ASUS TUF GAMING) por este vacio.
  computador: ['computador', 'pc', 'ordenador', 'portatil', 'laptop', 'notebook'],
  computadora: ['computador', 'pc', 'ordenador', 'portatil', 'laptop', 'notebook'],
  // "Compu" — misma logica que "cel"/"cels": abreviatura de texto comun,
  // nunca aparece asi en el catalogo.
  compu: ['computador', 'pc', 'ordenador', 'portatil', 'laptop', 'notebook'],
  ordenador: ['ordenador', 'computador', 'pc', 'portatil', 'laptop', 'notebook'],
  portatil: ['portatil', 'laptop', 'notebook', 'computador', 'pc'],
  portatiles: ['portatil', 'laptop', 'notebook', 'computador', 'pc'],
  laptop: ['laptop', 'portatil', 'notebook', 'computador', 'pc'],
  notebook: ['notebook', 'laptop', 'portatil', 'computador'],
  // "Jugar" en un pedido de compra casi siempre significa "gaming" en el
  // nombre real del producto ("LENOVO GAMING LOQ") — sin este puente, la
  // busqueda de texto nunca conecta la intencion con el producto.
  jugar: ['jugar', 'gaming', 'gamer', 'juegos'],
  juegos: ['juegos', 'gaming', 'gamer', 'jugar'],
  gaming: ['gaming', 'gamer', 'jugar', 'juegos'],
  gamer: ['gamer', 'gaming', 'jugar', 'juegos'],
  television: ['television', 'tv', 'televisor'],
  televisor: ['televisor', 'tv', 'television'],
  televisores: ['televisor', 'tv', 'television'],
  nevera: ['nevera', 'refrigerador', 'frigorifico'],
  refrigerador: ['refrigerador', 'nevera', 'frigorifico'],
  parlante: ['parlante', 'altavoz', 'bocina', 'corneta'],
  parlantes: ['parlante', 'altavoz', 'bocina', 'corneta'],
  bocina: ['bocina', 'parlante', 'altavoz', 'corneta'],
  bocinas: ['bocina', 'parlante', 'altavoz', 'corneta'],
  corneta: ['corneta', 'parlante', 'altavoz', 'bocina'],
  cornetas: ['corneta', 'parlante', 'altavoz', 'bocina'],
};

/**
 * Busqueda de catalogo con filtros combinables — usada por search_products,
 * find_products_by_budget, find_products_by_installment y como base de
 * similar/cheaper (seccion 29-30). Nunca usa SQL crudo del LLM: solo estos
 * filtros tipados.
 *
 * El texto libre usa OR entre palabras (con relevancia = cuantas
 * matchearon) en vez de exigir que todas aparezcan — igual filosofia que
 * `packages/rag`'s busqueda de texto completo, y por la misma razon: una
 * palabra generica que no aparece literalmente en ningun producto no debe
 * tumbar toda la busqueda.
 */
export async function searchProducts(filters: ProductSearchFilters): Promise<ProductRow[]> {
  const rows = await runProductSearch(filters, true);
  if (rows.length > 0 || (!filters.categoryName && !filters.brandName)) {
    return rows;
  }
  // El LLM extrae categoryName/brandName de lenguaje casual ("mouse
  // gamer", "auriculares de sonido") que a veces suena a categoria o marca
  // sin serlo — "gamer" no es ninguna marca ni categoria real del
  // catalogo. Un AND estricto ahi puede descartar TODOS los resultados
  // aunque el texto libre por si solo si hubiera encontrado productos
  // validos (bug real encontrado en pruebas: "mouse gamer que no pase de
  // 30 mil" no encontraba un mouse gamer real de $24.900 porque "gamer"
  // se colo como categoria/marca). Ante cero resultados, se reintenta sin
  // esos dos filtros — pero solo si queda alguna otra señal real (texto o
  // precio) que siga acotando la busqueda; si categoryName/brandName eran
  // el UNICO criterio, quitarlos devolveria cualquier producto activo sin
  // ninguna relacion, que es peor que decir honestamente que no hay nada.
  const hasOtherSignal = (filters.text ?? '').trim().length > 0 || filters.minPrice !== undefined || filters.maxPrice !== undefined;
  if (!hasOtherSignal) {
    return rows;
  }
  return runProductSearch({ ...filters, categoryName: undefined, brandName: undefined }, false);
}

async function runProductSearch(filters: ProductSearchFilters, applyCategoryAndBrand: boolean): Promise<ProductRow[]> {
  const pool = getPool();
  const conditions: string[] = ['p.is_active'];
  const values: unknown[] = [];
  // "0::numeric" y no un "0" a secas: Postgres interpreta un entero
  // constante en ORDER BY, incluso entre parentesis, como referencia
  // posicional a una columna del SELECT ("ORDER BY position 0 is not in
  // select list") — bug real encontrado al probar una busqueda sin texto
  // libre (solo categoria/precio), el unico caso donde este valor por
  // defecto llega intacto hasta el ORDER BY.
  let relevanceExpr = '0::numeric';

  const words = (filters.text ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1 && !SPANISH_STOPWORDS.has(word.toLowerCase()));

  if (words.length > 0) {
    const wordMatches: string[] = [];
    const wordScores: string[] = [];
    for (const word of words) {
      const variants = synonymVariants(word);
      // Separar donde matchea: nombre/categoria/marca es una señal fuerte
      // (el producto literalmente ES eso); una mencion solo en la
      // descripcion larga suele ser texto de marketing generico ("ideal
      // para jugar", "compatible con tu computador") que aparece en
      // productos sin ninguna relacion real. Sin esta distincion, un mouse
      // barato con esa frase en su descripcion empataba en relevancia con
      // un portatil gamer real y le ganaba por precio — bug real
      // encontrado en pruebas ("computador para jugar" no mostraba los
      // portatiles gamer reales entre los primeros resultados).
      const exactCategoryMatches: string[] = [];
      const strongMatches: string[] = [];
      const weakMatches: string[] = [];
      for (const variant of variants) {
        values.push(exactFormsFor(variant));
        exactCategoryMatches.push(unaccentCategoryExact(values.length));
        values.push(`%${variant}%`);
        const idx = values.length;
        strongMatches.push(`${unaccentIlike('p.name', idx)} OR ${unaccentIlike('c.name', idx)} OR ${unaccentIlike('b.name', idx)}`);
        weakMatches.push(unaccentIlike('p.description', idx));
      }
      const exactCategoryExpr = `(${exactCategoryMatches.join(' OR ')})`;
      const strongExpr = `(${strongMatches.join(' OR ')})`;
      const weakExpr = `(${weakMatches.join(' OR ')})`;
      wordMatches.push(`(${exactCategoryExpr} OR ${strongExpr} OR ${weakExpr})`);
      // La categoria exacta pesa mas que un match generico de nombre —
      // ver `unaccentCategoryExact` para el porque. (Se probo tambien dar
      // aun mas peso a un match de NOMBRE por encima de la categoria, para
      // el caso de "Combo Teclado..." mal categorizado bajo "Computadores"
      // en el catalogo de origen — pero se revirtio: "portatil" tambien es
      // un adjetivo generico en español ["Batidor... Portatil A Bateria"],
      // y priorizar el nombre por encima de la categoria traia de vuelta
      // el mismo tipo de falso positivo que esta funcion existe para
      // evitar. Ese caso puntual es un problema de datos del catalogo
      // fuente, no de este algoritmo — no vale la pena perseguirlo mas
      // con reglas de texto.)
      wordScores.push(`(CASE WHEN ${exactCategoryExpr} THEN 1.5 WHEN ${strongExpr} THEN 1 WHEN ${weakExpr} THEN 0.3 ELSE 0 END)`);
    }
    conditions.push(`(${wordMatches.join(' OR ')})`);
    relevanceExpr = wordScores.join(' + ');
  }

  // El LLM extrae `categoryName` de lo que el usuario escribio ("auriculares"),
  // no de la taxonomia real del catalogo ("Audífonos") — sin expandir
  // sinonimos aqui tambien, este filtro (un AND estricto) descartaba TODOS
  // los resultados aunque `text` si hubiera encontrado productos validos.
  if (applyCategoryAndBrand && filters.categoryName) {
    const categoryMatches = synonymVariants(filters.categoryName).map((variant) => {
      values.push(`%${variant}%`);
      return unaccentIlike('c.name', values.length);
    });
    conditions.push(`(${categoryMatches.join(' OR ')})`);
  }
  if (applyCategoryAndBrand && filters.brandName) {
    values.push(`%${filters.brandName}%`);
    conditions.push(unaccentIlike('b.name', values.length));
  }
  if (filters.minPrice !== undefined) {
    values.push(filters.minPrice);
    conditions.push(`p.price >= $${values.length}`);
  }
  if (filters.maxPrice !== undefined) {
    values.push(filters.maxPrice);
    conditions.push(`p.price <= $${values.length}`);
  }
  if (filters.maxInstallment !== undefined) {
    values.push(filters.maxInstallment);
    conditions.push(`p.installment_value IS NOT NULL AND p.installment_value <= $${values.length}`);
  }
  if (filters.onlyOffers) {
    conditions.push('p.is_offer');
  }
  if (filters.excludeProductId) {
    values.push(filters.excludeProductId);
    conditions.push(`p.id != $${values.length}`);
  }

  values.push(Math.min(filters.limit ?? 8, 20));
  const limitIdx = values.length;

  const sql = `${PRODUCT_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY (${relevanceExpr}) DESC, p.is_offer DESC, p.price ASC LIMIT $${limitIdx}`;
  const result = await pool.query<ProductRawRow>(sql, values);
  return result.rows.map(mapRow);
}

export async function getProductById(id: string): Promise<ProductRow | null> {
  const pool = getPool();
  const result = await pool.query<ProductRawRow>(`${PRODUCT_SELECT} WHERE p.id = $1`, [id]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function getProductsByIds(ids: string[]): Promise<ProductRow[]> {
  if (ids.length === 0) {
    return [];
  }
  const pool = getPool();
  const result = await pool.query<ProductRawRow>(`${PRODUCT_SELECT} WHERE p.id = ANY($1::uuid[])`, [ids]);
  return result.rows.map(mapRow);
}

/** El slug es el mismo segmento de la URL real (`/p/<slug>`) — usado para resolver el contexto de pagina (sección 33-34: si el usuario abre el chat desde una ficha de producto, se sabe cual sin que lo repita). */
export async function getProductBySlug(slug: string): Promise<ProductRow | null> {
  const pool = getPool();
  const result = await pool.query<ProductRawRow>(`${PRODUCT_SELECT} WHERE p.slug = $1 LIMIT 1`, [slug]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

/**
 * Busqueda por nombre para cuando el LLM solo tiene el nombre del producto
 * (no el id) — usa pg_trgm para quedarse con la coincidencia mas cercana en
 * vez de la primera que aparezca, e insensible a tildes en ambos lados.
 *
 * A proposito NO filtra por `is_active`: si el producto fue descontinuado
 * (el harvester ya no lo ve en el sitio), igual se resuelve para que el
 * tool que lo llamo pueda avisar "ya no esta disponible" en vez de fingir
 * que nunca existio — la decision de que hacer con un producto inactivo es
 * del llamador, no de esta funcion de resolucion.
 */
export async function findProductByName(name: string): Promise<ProductRow | null> {
  const pool = getPool();
  const result = await pool.query<ProductRawRow>(
    `${PRODUCT_SELECT} WHERE ${unaccentIlike('p.name', 1)} OR similarity(unaccent(p.name), unaccent($2)) > 0.3
     ORDER BY p.is_active DESC, unaccent(p.name) <-> unaccent($2) LIMIT 1`,
    [`%${name}%`, name],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export interface ProductAttributeRow {
  attributeKey: string;
  attributeName: string;
  attributeValue: string;
}

export async function getProductAttributes(productId: string): Promise<ProductAttributeRow[]> {
  const pool = getPool();
  const result = await pool.query<{ attribute_key: string; attribute_name: string; attribute_value: string }>(
    'SELECT attribute_key, attribute_name, attribute_value FROM product_attributes WHERE product_id = $1 ORDER BY attribute_name',
    [productId],
  );
  return result.rows.map((row) => ({
    attributeKey: row.attribute_key,
    attributeName: row.attribute_name,
    attributeValue: row.attribute_value,
  }));
}

export async function listCategories(limit = 200): Promise<Array<{ name: string; slug: string }>> {
  const pool = getPool();
  const result = await pool.query<{ name: string; slug: string }>(
    'SELECT DISTINCT c.name, c.slug FROM categories c JOIN products p ON p.category_id = c.id WHERE p.is_active ORDER BY c.name LIMIT $1',
    [limit],
  );
  return result.rows;
}

export async function listBrands(limit = 200): Promise<Array<{ name: string; slug: string }>> {
  const pool = getPool();
  const result = await pool.query<{ name: string; slug: string }>(
    'SELECT DISTINCT b.name, b.slug FROM brands b JOIN products p ON p.brand_id = b.id WHERE p.is_active ORDER BY b.name LIMIT $1',
    [limit],
  );
  return result.rows;
}

export async function listSellers(limit = 200): Promise<Array<{ name: string; slug: string }>> {
  const pool = getPool();
  const result = await pool.query<{ name: string; slug: string }>(
    'SELECT DISTINCT s.name, s.slug FROM sellers s JOIN products p ON p.seller_id = s.id WHERE p.is_active ORDER BY s.name LIMIT $1',
    [limit],
  );
  return result.rows;
}
