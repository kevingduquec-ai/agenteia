import type { ToolCall, ToolDefinition } from '@prefiero-ia/llm';

/** Contexto de ejecucion que todo handler de catalogo recibe ademas de sus argumentos — hoy solo el tenant (que catalogo/base de conocimiento consultar), pensado para crecer sin tener que volver a cambiar la firma de cada tool. */
export interface ToolContext {
  tenantId: string;
}

export type ToolHandler<TArgs = Record<string, unknown>, TResult = unknown> = (args: TArgs, ctx: ToolContext) => Promise<TResult>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * Registro central de las herramientas que el agente puede invocar (sección
 * 29-30 del documento maestro). El LLM nunca ejecuta nada directamente —
 * solo puede pedir "quiero llamar a la tool X con estos argumentos", y es
 * este registro el que decide si esa tool existe y corre el handler real
 * contra la base de datos/catalogo. Nunca expone SQL, shell ni URLs
 * arbitrarias como tool.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`La tool "${definition.name}" ya esta registrada.`);
    }
    this.tools.set(definition.name, { definition, handler });
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getDefinitions(names: string[]): ToolDefinition[] {
    return names
      .map((name) => this.tools.get(name)?.definition)
      .filter((def): def is ToolDefinition => def !== undefined);
  }

  async execute(call: Pick<ToolCall, 'name' | 'arguments'>, ctx: ToolContext): Promise<unknown> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      throw new Error(`Tool no registrada: "${call.name}"`);
    }
    return tool.handler(call.arguments, ctx);
  }
}
