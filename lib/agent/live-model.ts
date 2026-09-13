import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import {
  MAX_MODEL_CALL_MS,
  MAX_MODEL_RETRIES,
  MODEL_MAX_TOKENS,
  MODEL_TEMPERATURE,
} from "./loop";
import type {
  AgentContentBlock,
  AgentMessage,
  AgentModel,
  AgentToolDefinition,
  ModelTurn,
} from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

export interface LiveAnthropicClient {
  messages: {
    create(params: MessageCreateParamsNonStreaming): Promise<Message>;
  };
}

function objectInput(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function strictTool(definition: AgentToolDefinition): Tool {
  const inputSchema = definition.input_schema;
  return {
    name: definition.name,
    description: definition.description,
    input_schema: {
      ...inputSchema,
      type: "object",
      required: Array.isArray(inputSchema.required) ? inputSchema.required : [],
      additionalProperties: false,
    },
  };
}

function anthropicContentBlock(block: AgentContentBlock): MessageParam["content"] extends Array<infer Item> ? Item : never {
  if (block.type === "text") return { type: "text", text: block.text } as never;
  if (block.type === "tool_use") {
    return { type: "tool_use", id: block.id, name: block.name, input: block.input } as never;
  }
  return {
    type: "tool_result",
    tool_use_id: block.tool_use_id,
    content: JSON.stringify(block.result),
    is_error: block.result.status === "error" || block.result.status === "denied",
  } as never;
}

function mapMessages(messages: AgentMessage[]): { system?: string; messages: MessageParam[] } {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => typeof message.content === "string" ? message.content : message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n"))
    .join("\n\n");

  const mapped = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: typeof message.content === "string"
        ? message.content
        : message.content.map(anthropicContentBlock),
    }));

  return { system: system || undefined, messages: mapped };
}

function mapResponse(response: Message): AgentContentBlock[] {
  const content: AgentContentBlock[] = [];
  for (const block of response.content) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      content.push({ type: "tool_use", id: block.id, name: block.name, input: objectInput(block.input) });
    }
  }
  return content;
}

export function createLiveModel(client?: LiveAnthropicClient): AgentModel {
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  const resolvedClient = client ?? (() => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("DEMO_MODE=live requires ANTHROPIC_API_KEY");
    return new Anthropic({
      apiKey,
      timeout: MAX_MODEL_CALL_MS,
      maxRetries: MAX_MODEL_RETRIES,
    });
  })();

  return {
    provider: "anthropic",
    model,
    async complete(messages, tools): Promise<ModelTurn> {
      const mapped = mapMessages(messages);
      const response = await resolvedClient.messages.create({
        model,
        max_tokens: MODEL_MAX_TOKENS,
        temperature: MODEL_TEMPERATURE,
        system: mapped.system,
        messages: mapped.messages,
        tools: tools.map(strictTool),
      });
      return {
        content: mapResponse(response),
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      };
    },
  };
}
