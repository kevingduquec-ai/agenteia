import { describe, expect, it } from 'vitest';
import { ToolRegistry } from './tool-registry.js';

function def(name: string) {
  return { name, description: 'x', parameters: { type: 'object' as const, properties: {} } };
}

describe('ToolRegistry', () => {
  it('registra, ejecuta y pasa el ToolContext al handler', async () => {
    const registry = new ToolRegistry();
    registry.register(def('echo'), async (args, ctx) => ({ args, tenantId: ctx.tenantId }));

    const result = await registry.execute({ name: 'echo', arguments: { text: 'hola' } }, { tenantId: 'tenant-1' });
    expect(result).toEqual({ args: { text: 'hola' }, tenantId: 'tenant-1' });
  });

  it('rechaza registrar dos veces la misma tool', () => {
    const registry = new ToolRegistry();
    registry.register(def('dup'), async () => null);
    expect(() => registry.register(def('dup'), async () => null)).toThrow(/ya esta registrada/);
  });

  it('execute lanza para una tool que no existe — nunca ejecuta nada arbitrario', async () => {
    const registry = new ToolRegistry();
    await expect(registry.execute({ name: 'no-existe', arguments: {} }, { tenantId: 't' })).rejects.toThrow(/no registrada/);
  });

  it('has() refleja el estado real del registro', () => {
    const registry = new ToolRegistry();
    expect(registry.has('x')).toBe(false);
    registry.register(def('x'), async () => null);
    expect(registry.has('x')).toBe(true);
  });

  it('getDefinitions solo devuelve las definiciones pedidas que SI existen, en el mismo orden', () => {
    const registry = new ToolRegistry();
    registry.register(def('a'), async () => null);
    registry.register(def('b'), async () => null);

    const defs = registry.getDefinitions(['b', 'no-existe', 'a']);
    expect(defs.map((d) => d.name)).toEqual(['b', 'a']);
  });
});
