import { Injectable, Logger } from '@nestjs/common';
import { LLMGateway, type GenerateResult, type HealthCheckResult } from '@prefiero-ia/llm';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly gateway = LLMGateway.fromEnv(process.env, (usage) => {
    this.logger.log(
      `llm_usage provider=${usage.provider} model=${usage.model} input=${usage.inputTokens} output=${usage.outputTokens}`,
    );
  });

  healthCheck(): Promise<HealthCheckResult[]> {
    return this.gateway.healthCheck();
  }

  async chat(message: string): Promise<GenerateResult> {
    return this.gateway.generate({
      messages: [
        {
          role: 'system',
          content:
            'Eres Prefi, un agente inteligente de compras. Solo respondes con informacion verificable; nunca inventas precios ni condiciones.',
        },
        { role: 'user', content: message },
      ],
    });
  }
}
