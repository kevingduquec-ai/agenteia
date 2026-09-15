import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '../pool.js';
import { createTestTenant } from '../../test/fixtures.js';
import {
  countAdminUsersByRole,
  createAdminUser,
  deleteAdminUser,
  findAdminUserByUsername,
  listAdminUsers,
  updateAdminUserPassword,
} from './admin-user.repository.js';

afterAll(async () => {
  await closePool();
});

describe('admin-user.repository', () => {
  it('crea una cuenta y la lista sin exponer el hash de la contraseña', async () => {
    const tenant = await createTestTenant();
    const user = await createAdminUser(tenant.id, 'soporte1', 'hash-falso', 'soporte');
    expect(user).not.toHaveProperty('passwordHash');

    const users = await listAdminUsers(tenant.id);
    expect(users.map((u) => u.username)).toEqual(['soporte1']);
  });

  it('el mismo username puede existir en dos tenants distintos sin chocar', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    await createAdminUser(tenantA.id, 'soporte1', 'hash-a', 'soporte');
    const userB = await createAdminUser(tenantB.id, 'soporte1', 'hash-b', 'soporte');
    expect(userB.username).toBe('soporte1');
  });

  it('rechaza un username duplicado DENTRO del mismo tenant', async () => {
    const tenant = await createTestTenant();
    await createAdminUser(tenant.id, 'soporte1', 'hash-a', 'soporte');
    await expect(createAdminUser(tenant.id, 'soporte1', 'hash-b', 'admin')).rejects.toMatchObject({ code: '23505' });
  });

  it('findAdminUserByUsername exige el tenant correcto — el mismo username en otro tenant no se encuentra', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    await createAdminUser(tenantA.id, 'soporte1', 'hash-secreto', 'soporte');

    const foundInA = await findAdminUserByUsername(tenantA.id, 'soporte1');
    expect(foundInA?.passwordHash).toBe('hash-secreto');
    expect(await findAdminUserByUsername(tenantB.id, 'soporte1')).toBeNull();
  });

  it('countAdminUsersByRole cuenta solo dentro de ese tenant y ese rol', async () => {
    const tenant = await createTestTenant();
    await createAdminUser(tenant.id, 'admin1', 'hash', 'admin');
    await createAdminUser(tenant.id, 'soporte1', 'hash', 'soporte');
    await createAdminUser(tenant.id, 'soporte2', 'hash', 'soporte');

    expect(await countAdminUsersByRole(tenant.id, 'admin')).toBe(1);
    expect(await countAdminUsersByRole(tenant.id, 'soporte')).toBe(2);
  });

  it('deleteAdminUser/updateAdminUserPassword solo afectan cuentas del tenant indicado', async () => {
    const tenantA = await createTestTenant();
    const tenantB = await createTestTenant();
    const user = await createAdminUser(tenantA.id, 'soporte1', 'hash-viejo', 'soporte');

    const updatedByWrongTenant = await updateAdminUserPassword(tenantB.id, user.id, 'hash-nuevo');
    expect(updatedByWrongTenant).toBe(false);

    await deleteAdminUser(tenantB.id, user.id);
    expect(await listAdminUsers(tenantA.id)).toHaveLength(1);

    const updated = await updateAdminUserPassword(tenantA.id, user.id, 'hash-nuevo');
    expect(updated).toBe(true);
    expect((await findAdminUserByUsername(tenantA.id, 'soporte1'))?.passwordHash).toBe('hash-nuevo');

    await deleteAdminUser(tenantA.id, user.id);
    expect(await listAdminUsers(tenantA.id)).toHaveLength(0);
  });
});
