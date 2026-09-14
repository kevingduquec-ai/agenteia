import type OpenAI from 'openai';
import type { ChatMessage, GenerateResult, LLMProviderName, ToolCall, ToolDefinition } from '../types.js';

export function toOpenAIMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId ?? '',
      } satisfies OpenAI.Chat.ChatCompletionToolMessageParam;
    }
    return {
      role: message.role,
      content: message.content,
    } as OpenAI.Chat.ChatCompletionMessageParam;
  });
}

export function toOpenAITools(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function fromOpenAIResponse(
  response: OpenAI.Chat.ChatCompletion,
  provider: LLMProviderName,
  model: string,
): GenerateResult {
  const choice = response.choices[0];
  const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? [])
    .filter((call): call is OpenAI.Chat.ChatCompletionMessageToolCall & { function: NonNullable<unknown> } =>
      'function' in call,
    )
    .map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: safeParseJson(call.function.arguments),
    }));

  return {
    content: choice?.message?.content ?? null,
    toolCalls,
    finishReason: mapFinishReason(choice?.finish_reason),
    provider,
    model,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

function mapFinishReason(reason: string | null | undefined): GenerateResult['finishReason'] {
  if (reason === 'tool_calls' || reason === 'length') {
    return reason;
  }
  return 'stop';
}

function safeParseJson(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
