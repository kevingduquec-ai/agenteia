import { Injectable } from '@nestjs/common';
import { findAdminUserByUsername } from '@prefiero-ia/database';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Sesion de 12h: suficientemente comoda para una jornada de trabajo del
// dueño del marketplace o del agente de soporte, sin dejar un token valido
// indefinidamente.
const TOKEN_TTL_SECONDS = 60 * 60 * 12;

// Hash bcrypt "dummy" para comparar contra el cuando el usuario no
// coincide — sin esto, un intento de login con usuario invalido responde
// mas rapido que uno con password invalido, filtrando por timing si el
// usuario existe o no.
const DUMMY_HASH = '$2b$10$hCp4mnb.K51ROzZRJWJCverVnqHDpvSBxlcVM5jdGn.yc7XCh1gOi';

export type AdminRole = 'owner' | 'admin' | 'soporte';

export interface AdminTokenPayload {
  sub: string;
  role: AdminRole;
  /**
   * A que tenant quedo atado este login — para "admin"/"soporte" es
   * siempre el suyo (viven en `admin_users.tenant_id`). Para "owner" es el
   * tenant desde cuyo subdominio inicio sesion (el owner es global por
   * variables de entorno, sin tenant propio) — para operar sobre otro
   * cliente, inicia sesion de nuevo desde el subdominio de ESE cliente.
   */
  tenantId: string;
}

/**
 * Autenticacion del panel admin. Un solo "owner" fijo via variables de
 * entorno (bootstrap — alguien tiene que poder crear al resto), superadmin
 * de la plataforma: puede operar sobre cualquier tenant, y es quien crea
 * cuentas "admin"/"soporte" DENTRO de un tenant especifico desde el panel
 * (`admin_users`, ver `AdminUsersController`): "admin" ve dashboards +
 * bandeja de soporte, "soporte" SOLO la bandeja, nunca analitica — pedido
 * explicito del usuario. Ninguna contraseña se guarda en texto plano,
 * solo su hash bcrypt.
 */
@Injectable()
export class AdminAuthService {
  async validateCredentials(tenantId: string, username: string, password: string): Promise<AdminRole | null> {
    const ownerUsername = process.env.OWNER_USERNAME;
    const ownerPasswordHash = process.env.OWNER_PASSWORD_HASH;

    if (ownerUsername && username === ownerUsername) {
      if (!ownerPasswordHash) {
        return null;
      }
      const valid = await bcrypt.compare(password, ownerPasswordHash);
      return valid ? 'owner' : null;
    }

    const managedUser = await findAdminUserByUsername(tenantId, username);
    if (!managedUser) {
      await bcrypt.compare(password, DUMMY_HASH);
      return null;
    }
    const valid = await bcrypt.compare(password, managedUser.passwordHash);
    return valid ? managedUser.role : null;
  }

  issueToken(tenantId: string, username: string, role: AdminRole): string {
    return jwt.sign({ sub: username, role, tenantId }, requireSecret(), { expiresIn: TOKEN_TTL_SECONDS });
  }

  verifyToken(token: string): AdminTokenPayload | null {
    try {
      return jwt.verify(token, requireSecret()) as AdminTokenPayload;
    } catch {
      return null;
    }
  }

  get cookieMaxAgeMs(): number {
    return TOKEN_TTL_SECONDS * 1000;
  }
}

function requireSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET no esta configurado (ver .env.example).');
  }
  return secret;
}
