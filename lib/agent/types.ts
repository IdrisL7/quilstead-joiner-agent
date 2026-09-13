import type { BuddyAvailabilityResult } from "@/lib/policy/buddy-availability";
import type { BuddyRequest, BuddySlot, Case, Draft, Joiner, ToolResult } from "@/lib/types";

export type AgentMode = "mock" | "live";
export type AgentTrigger = "contract.signed" | "start_date_changed" | "buddy_declined" | "availability_changed" | "question";
export type StopReason = "finished" | "step_cap" | "tool_cap" | "time_cap" | "guard" | "model_error";

export interface AgentToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  name: string;
  result: ToolResult;
}

export interface TextBlock {
  type: "text";
  text: string;
}

export type AgentContentBlock = ToolUseBlock | ToolResultBlock | TextBlock;

export interface AgentMessage {
  role: "system" | "user" | "assistant";
  content: string | AgentContentBlock[];
}

export interface ModelTurn {
  content: AgentContentBlock[];
  retried?: string; // set when the adapter retried once after a rate limit or overload
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface AgentModel {
  provider: "mock" | "anthropic";
  model: string;
  complete(messages: AgentMessage[], tools: AgentToolDefinition[]): Promise<ModelTurn>;
}

export interface AgentTraceEntry {
  actor: "system" | "agent" | "human";
  kind: string;
  summary: string;
}

export interface AgentStep {
  n: number;
  kind: "tool" | "guard.refused";
  tool: string;
  args: Record<string, unknown>;
  result_summary: string;
  ms: number;
}

export interface AgentProposal {
  draft: Draft;
  before_approval: ToolResult;
  reason: string;
  evidence: string[];
  request?: BuddyRequest;
}

export interface AgentRun {
  run_id: string;
  trigger: AgentTrigger;
  provider: "mock" | "anthropic";
  model: string;
  steps: AgentStep[];
  model_steps: number;
  tool_calls: number;
  refused: number;
  stop_reason: StopReason;
  next_action: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  started_at: string;
  finished_at: string;
  proposals: AgentProposal[];
  availability: BuddyAvailabilityResult | null;
  equipment: ToolResult | null;
  trace: AgentTraceEntry[];
  input_state_hash: string;
}

export interface AgentContext {
  case: Case;
  joiner: Joiner;
  trigger: AgentTrigger;
  now: string;
}

export interface AgentRuntimeState {
  equipment: ToolResult | null;
  availability: BuddyAvailabilityResult | null;
  proposals: AgentProposal[];
  staged_drafts: Draft[];
  staged_requests: BuddyRequest[];
  staged_slots: BuddySlot[];
  guard_refusals: Map<string, number>;
  next_action: string | null;
  finished: boolean;
  escalations_recorded: number;
}

export interface AgentRuntime {
  state: AgentRuntimeState;
  dispatch(name: string, input: Record<string, unknown>): Promise<ToolResult>;
}

export interface RunAgentOptions {
  model?: AgentModel;
  force?: boolean;
  toolDefinitions?: AgentToolDefinition[];
  runtimeFactory?: (context: AgentContext) => AgentRuntime;
  systemPrompt?: string;
  userMessage?: string;
  maxSteps?: number;
  maxToolCalls?: number;
  maxRunMs?: number;
  maxModelCallMs?: number;
  commit?: boolean;
  cache?: boolean;
}
