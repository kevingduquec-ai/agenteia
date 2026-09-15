import { describe, expect, it } from 'vitest';
import type { ProductSummary } from '@prefiero-ia/catalog';
import { MIN_SEMANTIC_SCORE_FOR_RELEVANCE, rankProducts, type RankingCandidate } from './ranking.js';

function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: overrides.id ?? 'p1',
    name: 'Producto de prueba',
    url: 'https://example.com/p/producto',
    imageUrl: null,
    price: 100_000,
    originalPrice: null,
    discountPercentage: null,
    installmentValue: null,
    installmentCount: null,
    currency: 'COP',
    isOffer: false,
    isActive: true,
    categoryName: null,
    brandName: null,
    sellerName: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<RankingCandidate> = {}): RankingCandidate {
  return { product: product(), ...overrides };
}

describe('rankProducts', () => {
  it('ordena de mayor a menor score', () => {
    const good = candidate({ product: product({ id: 'good', name: 'Portátil Gamer', price: 1_500_000 }) });
    const bad = candidate({ product: product({ id: 'bad', name: 'Cargador Genérico', price: 50_000 }) });

    const ranked = rankProducts({ need: 'portatil gamer', budget: 1_500_000 }, [bad, good]);
    expect(ranked[0].product.id).toBe('good');
  });

  it('needMatch: 100% de las palabras relevantes presentes en nombre/categoria/marca da needMatch 1', () => {
    const [ranked] = rankProducts(
      { need: 'laptop gaming' },
      [candidate({ product: product({ name: 'Laptop Gaming LOQ', categoryName: 'Portátiles', brandName: 'Lenovo' }) })],
    );
    expect(ranked.needMatch).toBe(1);
  });

  it('needMatch normaliza tildes — una palabra pedida sin tilde SI matchea la misma palabra con tilde en el catalogo', () => {
    // Mismo criterio que product-search.repository (unaccent() en SQL) y
    // rag/search.ts — un "need" extraido por el LLM sin tilde (comun en
    // extraccion de texto libre) debe encontrar "Portátil" con tilde en el
    // catalogo real, o el 30% del score (needMatch) se degrada sin motivo.
    const [ranked] = rankProducts({ need: 'portatil gamer' }, [candidate({ product: product({ name: 'Portátil Gámer LOQ' }) })]);
    expect(ranked.needMatch).toBe(1);
  });

  it('needMatch: ninguna palabra relevante presente da needMatch 0', () => {
    const [ranked] = rankProducts({ need: 'nevera no frost' }, [candidate({ product: product({ name: 'Televisor 55 pulgadas' }) })]);
    expect(ranked.needMatch).toBe(0);
  });

  it('needMatch: sin "need" en el criterio, usa un valor neutral (0.6) en vez de penalizar', () => {
    const [ranked] = rankProducts({}, [candidate()]);
    expect(ranked.needMatch).toBeCloseTo(0.6, 5);
  });

  it('budgetFit: castiga precios por encima del presupuesto, premia los que aprovechan el cupo sin pasarlo', () => {
    const withinBudget = candidate({ product: product({ id: 'within', price: 950_000 }) });
    const overBudget = candidate({ product: product({ id: 'over', price: 2_000_000 }) });

    const [rankedWithin, rankedOver] = rankProducts({ budget: 1_000_000 }, [withinBudget, overBudget]);
    expect(rankedWithin.score).toBeGreaterThan(rankedOver.score);
  });

  it('semanticSimilarity: usa el score real del candidato si vino de busqueda vectorial, 0.5 neutral si no', () => {
    const [withScore] = rankProducts({}, [candidate({ semanticScore: 0.9 })]);
    expect(withScore.semanticSimilarity).toBe(0.9);

    const [withoutScore] = rankProducts({}, [candidate()]);
    expect(withoutScore.semanticSimilarity).toBe(0.5);
  });

  it('un producto en promocion (isOffer) obtiene un score mayor que uno idéntico sin promocion', () => {
    const offer = candidate({ product: product({ id: 'offer', isOffer: true }) });
    const noOffer = candidate({ product: product({ id: 'no-offer', isOffer: false }) });

    const ranked = rankProducts({}, [noOffer, offer]);
    expect(ranked.find((r) => r.product.id === 'offer')!.score).toBeGreaterThan(
      ranked.find((r) => r.product.id === 'no-offer')!.score,
    );
  });

  it('features: 0.5 neutral cuando no hay attributeText (harvester sin specs, hueco conocido)', () => {
    const [ranked] = rankProducts({ desiredFeatures: ['8gb ram'] }, [candidate()]);
    // No se expone directamente el score de features, pero se puede
    // verificar indirectamente: dos candidatos identicos salvo
    // attributeText deben empatar en score si el feature no matchea en
    // ninguno de los dos (ambos caen al mismo neutral).
    const [withAttrs] = rankProducts({ desiredFeatures: ['8gb ram'] }, [candidate({ attributeText: '8GB RAM, 256GB SSD' })]);
    expect(withAttrs.score).toBeGreaterThan(ranked.score);
  });

  it('buildReasons: incluye "dentro de tu presupuesto" solo cuando el precio realmente cabe', () => {
    const [inBudget] = rankProducts({ budget: 200_000 }, [candidate({ product: product({ price: 150_000 }) })]);
    expect(inBudget.reasons.some((r) => r.startsWith('Dentro de tu presupuesto'))).toBe(true);

    const [overBudget] = rankProducts({ budget: 100_000 }, [candidate({ product: product({ price: 150_000 }) })]);
    expect(overBudget.reasons.some((r) => r.startsWith('Dentro de tu presupuesto'))).toBe(false);
  });

  it('buildReasons: incluye "esta en promocion" solo si isOffer', () => {
    const [ranked] = rankProducts({}, [candidate({ product: product({ isOffer: true }) })]);
    expect(ranked.reasons).toContain('Está en promoción');
  });

  it('MIN_SEMANTIC_SCORE_FOR_RELEVANCE es el mismo umbral que packages/rag usa para similitud vectorial', () => {
    expect(MIN_SEMANTIC_SCORE_FOR_RELEVANCE).toBe(0.55);
  });
});
