import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import type { TenantRow } from '@prefiero-ia/database';
import { ADMIN_COOKIE_NAME, AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';

class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  // Limite estricto: un endpoint de login es el blanco obvio de fuerza bruta.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginDto, @CurrentTenant() tenant: TenantRow, @Res({ passthrough: true }) res: Response) {
    const role = await this.authService.validateCredentials(tenant.id, body.username, body.password);
    if (!role) {
      return { ok: false, message: 'Usuario o contraseña incorrectos.' };
    }

    const token = this.authService.issueToken(tenant.id, body.username, role);
    res.cookie(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: this.authService.cookieMaxAgeMs,
      path: '/',
    });
    return { ok: true, role };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ADMIN_COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  @UseGuards(AdminAuthGuard)
  @Get('me')
  me(@Req() req: Request) {
    return { ok: true, role: req.adminUser?.role };
  }
}
