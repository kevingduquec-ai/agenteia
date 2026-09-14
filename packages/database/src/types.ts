export interface ProductUpsertInput {
  externalId: string;
  name: string;
  slug: string;
  description: string | null;
  url: string;
  imageUrl: string | null;
  brandId: string | null;
  categoryId: string | null;
  sellerId: string | null;
  price: number;
  originalPrice: number | null;
  discountPercentage: number | null;
  installmentValue: number | null;
  installmentCount: number | null;
  currency: string;
  contentHash: string;
}

export interface CategoryPathSegment {
  name: string;
  slug: string;
}

export interface UpsertProductResult {
  id: string;
  status: 'created' | 'updated' | 'unchanged';
}
