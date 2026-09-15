import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { TenantRow } from '@prefiero-ia/database';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { KnowledgeService } from './knowledge.service.js';

class SearchKnowledgeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit?: number;
}

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get('search')
  async search(@Query() query: SearchKnowledgeDto, @CurrentTenant() tenant: TenantRow) {
    const results = await this.knowledgeService.search(tenant.id, query.q.trim(), query.limit);

    return {
      query: query.q,
      results,
      // Si no hay embeddings configurados/generados todavia, algunos
      // resultados vienen solo de full-text — se marca para que el caller
      // (o el agente) pueda decidir si vale la pena mostrarlos igual.
      usedVectorSearch: results.some((r) => r.matchType === 'vector'),
    };
  }
}
