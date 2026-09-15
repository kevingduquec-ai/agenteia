import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import { AdminAuthController } from './admin-auth.controller.js';
import { AdminAuthGuard, AdminOnlyGuard, OwnerOnlyGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminOwnerController } from './admin-owner.controller.js';
import { AdminStatsController } from './admin-stats.controller.js';
import { AdminSupportController } from './admin-support.controller.js';
import { AdminTenantsController } from './admin-tenants.controller.js';
import { AdminUsersController } from './admin-users.controller.js';

@Module({
  imports: [LlmModule],
  controllers: [
    AdminAuthController,
    AdminStatsController,
    AdminSupportController,
    AdminUsersController,
    AdminOwnerController,
    AdminTenantsController,
  ],
  providers: [AdminAuthService, AdminAuthGuard, AdminOnlyGuard, OwnerOnlyGuard],
})
export class AdminModule {}
