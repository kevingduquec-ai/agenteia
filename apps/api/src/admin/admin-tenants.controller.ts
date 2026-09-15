import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  addKnowledgeSource,
  createTenant,
  deleteKnowledgeSource,
  listKnowledgeSourcesByTenant,
  listTenants,
  type KnowledgeSourceKind,
} from '@prefiero-ia/database';
import { AdminAuthGuard, OwnerOnlyGuard } from './admin-auth.guard.js';

const KNOWLEDGE_SOURCE_KINDS: KnowledgeSourceKind[] = ['heading', 'frequent-questions-api'];

class CreateTenantDto {
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'slug debe ser minusculas, numeros y guiones (ej. "acr").' })
  @MinLength(2)
  @MaxLength(60)
  slug!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9.-]+$/, { message: 'host debe ser un dominio valido, sin protocolo (ej. "acr.app.tu-dominio.com").' })
  @MinLength(3)
  @MaxLength(255)
  host!: string;

  @IsUrl({ require_protocol: true })
  crawlerBaseUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  extraCorsOrigins?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  maxAdminSeats?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  maxSupportSeats?: number;
}

class AddKnowledgeSourceDto {
  @IsUrl({ require_protocol: true })
  url!: string;

  @IsOptional()
  @IsIn(KNOWLEDGE_SOURCE_KINDS)
  kind?: KnowledgeSourceKind;

  // Solo tiene sentido cuando `url` es un endpoint de API — la URL real a
  // mostrar/guardar como fuente del documento (ver knowledge-source.repository.ts).
  @IsOptional()
  @IsUrl({ require_protocol: true })
  sourceUrl?: string;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;
}

/**
 * Alta de clientes nuevos y de sus fuentes de conocimiento — exclusivo
 * del owner, hasta ahora solo posible por CLI (`create-tenant`/
 * `add-knowledge-source` en apps/worker). Deliberadamente GLOBAL, sin
 * `@CurrentTenant()`: el owner opera "desde" el subdominio de un cliente
 * que ya existe, pero da de alta y administra TODOS los tenants, no solo
 * ese uno — ver docs/MULTI-TENANCY.md ("Qubit... administra... de
 * CUALQUIER tenant").
 */
@UseGuards(AdminAuthGuard, OwnerOnlyGuard)
@Controller('admin/tenants')
export class AdminTenantsController {
  @Get()
  async list() {
    return listTenants();
  }

  @Post()
  async create(@Body() body: CreateTenantDto) {
    try {
      const tenant = await createTenant({
        slug: body.slug,
        name: body.name,
        host: body.host,
        crawlerBaseUrl: body.crawlerBaseUrl,
        extraCorsOrigins: body.extraCorsOrigins,
        maxAdminSeats: body.maxAdminSeats,
        maxSupportSeats: body.maxSupportSeats,
      });
      return { ok: true, tenant };
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code: string }).code === '23505') {
        throw new BadRequestException('Ya existe un tenant con ese slug o ese host.');
      }
      throw error;
    }
  }

  @Get(':id/knowledge-sources')
  async listSources(@Param('id', ParseUUIDPipe) id: string) {
    return listKnowledgeSourcesByTenant(id);
  }

  @Post(':id/knowledge-sources')
  async addSource(@Param('id', ParseUUIDPipe) id: string, @Body() body: AddKnowledgeSourceDto) {
    const source = await addKnowledgeSource(id, {
      url: body.url,
      kind: body.kind ?? 'heading',
      sourceUrl: body.sourceUrl,
      headers: body.headers,
    });
    return { ok: true, source };
  }

  @Delete(':id/knowledge-sources/:sourceId')
  async removeSource(@Param('id', ParseUUIDPipe) id: string, @Param('sourceId', ParseUUIDPipe) sourceId: string) {
    await deleteKnowledgeSource(id, sourceId);
    return { ok: true };
  }
}
