import { Body, Controller, Get, Post, ServiceUnavailableException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { LLMNotConfiguredError } from '@prefiero-ia/llm';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { LlmService } from './llm.service.js';

class ChatRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}

@Controller('llm')
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  @Get('health')
  async health() {
    const providers = await this.llmService.healthCheck();
    return {
      ok: providers.some((provider) => provider.ok),
      providers,
    };
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('chat')
  async chat(@Body() body: ChatRequestDto) {
    try {
      return await this.llmService.chat(body.message);
    } catch (error) {
      if (error instanceof LLMNotConfiguredError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }
}
