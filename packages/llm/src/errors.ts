export class LLMNotConfiguredError extends Error {
  constructor(provider: string) {
    super(
      `El proveedor "${provider}" no tiene API key configurada. Define la variable de entorno correspondiente (ver .env.example) para habilitarlo.`,
    );
    this.name = 'LLMNotConfiguredError';
  }
}
