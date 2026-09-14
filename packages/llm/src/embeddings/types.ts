export interface EmbeddingResult {
  embedding: number[];
  model: string;
}

export interface EmbeddingProvider {
  readonly model: string;
  isConfigured(): boolean;
  embed(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
}
