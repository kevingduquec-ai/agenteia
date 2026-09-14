import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import {
  countAdminUsersByRole,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  updateAdminUserPassword,
  type ManagedAdminRole,
} from '@prefiero-ia/database';
import bcrypt from 'bcryptjs';
import { AdminAuthGuard, OwnerOnlyGuard } from './admin-auth.guard.js';

const MANAGED_ROLES: ManagedAdminRole[] = ['admin', 'soporte'];

class CreateAdminUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username!: string;

  // Password minima de 10 caracteres: son cuentas de panel administrativo,
  // no de clientes finales — vale la pena exigir un poco mas.
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;

  // @IsIn restringe el valor a EXACTAMENTE 'admin' | 'soporte' — nunca
  // 'owner'. Esto es lo que evita que un body manipulado escale
  // privilegios pidiendo role: 'owner' al crear una cuenta.
  @IsIn(MANAGED_ROLES)
  role!: ManagedAdminRole;
}

class ResetPasswordDto {
  // Pedido explicito del usuario: admin y soporte no pueden cambiar su
  // propia contraseña, solo el owner la resetea desde aqui.
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;
}

function seatLimit(role: ManagedAdminRole): number {
  const envVar = role === 'admin' ? process.env.MAX_ADMIN_SEATS : process.env.MAX_SUPPORT_SEATS;
  const parsed = Number(envVar);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Gestion de cuentas admin/soporte — SOLO el owner (pedido explicito del
 * usuario: "un solo rol que sea el owner tambien... los pueda crear").
 * Aplica el limite de cupos del plan: "vendo el producto... con un solo
 * agente de soporte y un admin, con la posibilidad de que me compren otro".
 */
@UseGuards(AdminAuthGuard, OwnerOnlyGuard)
@Controller('admin/users')
export class AdminUsersController {
  @Get()
  async list() {
    const users = await listAdminUsers();
    return {
      users,
      seats: {
        admin: { used: users.filter((u) => u.role === 'admin').length, limit: seatLimit('admin') },
        soporte: { used: users.filter((u) => u.role === 'soporte').length, limit: seatLimit('soporte') },
      },
    };
  }

  // Limite estricto: creacion de cuentas no debe ser blanco de scripts
  // automatizados, y el hash bcrypt ya es costoso de por si.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  async create(@Body() body: CreateAdminUserDto) {
    const used = await countAdminUsersByRole(body.role);
    const limit = seatLimit(body.role);
    if (used >= limit) {
      throw new BadRequestException(
        `Ya usas ${used}/${limit} cupos de ${body.role === 'admin' ? 'administrador' : 'soporte'} incluidos en tu plan. Contacta a ventas para ampliar.`,
      );
    }

    const passwordHash = await bcrypt.hash(body.password, 10);
    try {
      const user = await createAdminUser(body.username.trim(), passwordHash, body.role);
      return { ok: true, user };
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code: string }).code === '23505') {
        throw new BadRequestException('Ese nombre de usuario ya existe.');
      }
      throw error;
    }
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await deleteAdminUser(id);
    return { ok: true };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Patch(':id/password')
  async resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() body: ResetPasswordDto) {
    const passwordHash = await bcrypt.hash(body.password, 10);
    const updated = await updateAdminUserPassword(id, passwordHash);
    if (!updated) {
      throw new NotFoundException('Esa cuenta no existe.');
    }
    return { ok: true };
  }
}
