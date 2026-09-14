export type LLMProviderName = 'qwen' | 'deepseek';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface GenerateOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  provider: LLMProviderName;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

export interface HealthCheckResult {
  provider: LLMProviderName;
  configured: boolean;
  ok: boolean;
  model: string;
  message?: string;
}

export interface LLMProvider {
  readonly name: LLMProviderName;
  readonly model: string;
  isConfigured(): boolean;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): AsyncGenerator<StreamChunk, GenerateResult, void>;
  callTools(options: GenerateOptions & { tools: ToolDefinition[] }): Promise<GenerateResult>;
  healthCheck(): Promise<HealthCheckResult>;
}

export interface UsageEvent {
  provider: LLMProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
}
