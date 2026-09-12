import type { ToolResult } from "@/lib/types";

// One interface for every system the agent touches. Simulated adapters implement it in
// v1; production adapters (Humaans API, Okta, Slack, DocuSign) implement the same shape.
// Every action: one purpose, a narrow schema, a structured result, a timeout owned by the gate.

export type ToolArgs = Record<string, unknown>;
export type ToolAction = (args: ToolArgs) => Promise<ToolResult>;

export interface Connector {
  name: string;
  description: string;
  simulated: boolean;
  production_target: string; // what replaces this adapter in a live deployment
  actions: Record<string, { description: string; schema: Record<string, string>; run: ToolAction }>;
}

export const ok = <T>(summary: string, data?: T, extra: Partial<ToolResult<T>> = {}): ToolResult<T> => ({ status: "ok", summary, data, ...extra });
export const denied = (summary: string): ToolResult => ({ status: "denied", summary, retryable: false });
export const failed = (summary: string, retryable = false): ToolResult => ({ status: "error", summary, retryable });
