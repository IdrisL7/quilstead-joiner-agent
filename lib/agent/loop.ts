import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { authorize } from "@/lib/permissions";
import { buildContract } from "@/lib/contract";
import { findAction } from "@/lib/connectors/registry";
import { discardDraft, registerDraft } from "@/lib/connectors/simulated/messaging";
import type { Case, Joiner, ToolResult } from "@/lib/types";
import { createLiveModel } from "./live-model";
import { createMockModel } from "./mock-model";
import { AGENT_TOOL_DEFINITIONS, createAgentToolRuntime } from "./tools";
import type {
  AgentContext,
  AgentMessage,
  AgentModel,
  AgentRun,
  AgentStep,
  AgentTraceEntry,
  AgentTrigger,
  AgentMode,
  RunAgentOptions,
  StopReason,
  ToolResultBlock,
  ToolUseBlock,
} from "./types";

export const MAX_STEPS = 8;
export const MAX_TOOL_CALLS = 12;
export const MAX_RUN_MS = 60_000;
export const MAX_MODEL_CALL_MS = 15_000;
export const MAX_MODEL_RETRIES = 0;
export const MODEL_TEMPERATURE = 0;
export const MODEL_MAX_TOKENS = 600;
export const HAIKU_INPUT_USD_PER_MILLION = 1;
export const HAIKU_OUTPUT_USD_PER_MILLION = 5;

const priorRuns = new Map<string, AgentRun>();

export const resetAgentRuns = (): void => {
  priorRuns.clear();
};

function inputStateHash(c: Case): string {
  return createHash("sha256").update(JSON.stringify({
    case_id: c.id,
    joiner_id: c.joiner_id,
    event_id: c.event_id,
    start_date: c.start_date,
    task_dates: c.tasks.map((task) => ({ type: task.type, due_at: task.due_at })),
    task_statuses: c.tasks
      .filter((task) => task.type !== "buddy_allocation")
      .map((task) => ({ type: task.type, status: task.status })),
    human_draft_decisions: c.drafts
      .filter((draft) => draft.status !== "pending")
      .map((draft) => ({ id: draft.id, status: draft.status, decided_by: draft.decided_by, decision_reason: draft.decision_reason })),
    buddy_decisions: c.buddy_requests
      .filter((request) => request.status !== "pending_approval")
      .map((request) => ({ id: request.id, candidate_id: request.candidate_id, status: request.status, response: request.response })),
    buddy_id: c.buddy_id ?? null,
  })).digest("hex");
}

function traceEntry(kind: string, summary: string): AgentTraceEntry {
  return { actor: "agent", kind, summary };
}

function appendCaseStep(c: Case, kind: string, summary: string, at: string, data?: Record<string, unknown>): void {
  c.steps.push({
    id: `${c.id}-S-${String(c.steps.length + 1).padStart(4, "0")}`,
    case_id: c.id,
    at,
    actor: "agent",
    kind,
    summary,
    data,
  });
}

function toolBlocks(content: AgentMessage["content"]): ToolUseBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is ToolUseBlock => block.type === "tool_use");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Model call exceeded ${timeoutMs}ms.`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function permissionResult(name: string): ToolResult {
  const permission = authorize(name);
  return {
    status: "denied",
    summary: `Tool ${name} refused by permission policy (${permission.mode}).`,
    retryable: false,
  };
}

function toolResultBlock(block: ToolUseBlock, result: ToolResult): ToolResultBlock {
  return { type: "tool_result", tool_use_id: block.id, name: block.name, result };
}

function runKey(c: Case, trigger: AgentTrigger, stateHash: string): string {
  return `${c.id}:${trigger}:${stateHash}`;
}

function costForTokens(inputTokens: number, outputTokens: number): number {
  return inputTokens * HAIKU_INPUT_USD_PER_MILLION / 1_000_000
    + outputTokens * HAIKU_OUTPUT_USD_PER_MILLION / 1_000_000;
}

function systemPrompt(joiner: Joiner, c: Case): string {
  const countrySop = path.join(process.cwd(), "data", "sops", `${joiner.country === "UK" ? "uk" : joiner.country === "US" ? "us" : "de"}-joiner.md`);
  const readinessSop = path.join(process.cwd(), "data", "sops", "day-one-readiness.md");
  const readiness = readFileSync(readinessSop, "utf8").trim();
  const country = readFileSync(countrySop, "utf8").trim();
  const contract = buildContract(joiner, c.id);
  return [
    "You are Athena's bounded onboarding assistant.",
    "Read the case first. Use tools for facts. Never invent dates, recipients, eligibility or permissions.",
    "Propose pending messages only. Never send, grant access, write HRIS data or complete compliance work.",
    "Recipients: a nudge goes to the equipment task owner_id from check_equipment; a buddy_request goes to a candidate_id from get_buddy_availability. Quote dates exactly as tool results show them.",
    `Day-one readiness SOP:\n${readiness}`,
    `Country SOP:\n${country}`,
    `Task contract:\n${JSON.stringify(contract)}`,
  ].join("\n\n");
}

async function commitRuntime(
  original: Case,
  working: Case,
  runtime: ReturnType<typeof createAgentToolRuntime>,
  now: string,
): Promise<void> {
  const registered: string[] = [];
  try {
    for (const draft of runtime.state.staged_drafts) {
      if (!registerDraft(draft)) throw new Error(`Agent draft was not registered: ${draft.id}`);
      registered.push(draft.id);
    }
    const slack = findAction("slack.send_message");
    if (!slack) throw new Error("Slack send action is not registered.");
    for (const proposal of runtime.state.proposals) {
      proposal.before_approval = await slack.action.run({ draft_id: proposal.draft.id, now });
    }
    Object.assign(original, working);
    for (const proposal of runtime.state.proposals) {
      proposal.draft = original.drafts.find((draft) => draft.id === proposal.draft.id) ?? proposal.draft;
      if (proposal.request) {
        proposal.request = original.buddy_requests.find((request) => request.id === proposal.request?.id) ?? proposal.request;
      }
    }
  } catch (error) {
    for (const draftId of registered) discardDraft(draftId);
    throw error;
  }
}

function buildModel(mode: AgentMode, context: AgentContext, options?: RunAgentOptions): AgentModel {
  if (options?.model) return options.model;
  if (mode === "mock") return createMockModel({ case: context.case, joiner: context.joiner, trigger: context.trigger });
  return createLiveModel();
}

function unavailableRun(
  context: AgentContext,
  provider: "mock" | "anthropic",
  model: string,
  inputHash: string,
  startedAt: string,
  reason: StopReason,
  steps: AgentStep[],
  modelSteps: number,
  toolCalls: number,
  refused: number,
  trace: AgentTraceEntry[],
  nextAction: string | null = "Run assistant again.",
  inputTokens = 0,
  outputTokens = 0,
): AgentRun {
  return {
    run_id: `AGENT-RUN-${randomUUID()}`,
    trigger: context.trigger,
    provider,
    model,
    steps,
    model_steps: modelSteps,
    tool_calls: toolCalls,
    refused,
    stop_reason: reason,
    next_action: nextAction,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costForTokens(inputTokens, outputTokens),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    proposals: [],
    availability: null,
    equipment: null,
    trace,
    input_state_hash: inputHash,
  };
}

export async function runAgent(
  c: Case,
  joiner: Joiner,
  trigger: AgentTrigger,
  now: string,
  mode: AgentMode = "mock",
  options?: RunAgentOptions,
): Promise<AgentRun> {
  const stateHash = inputStateHash(c);
  const key = runKey(c, trigger, stateHash);
  const previous = options?.force ? undefined : priorRuns.get(key);
  if (previous) return previous;

  const startedAt = new Date().toISOString();
  const working = structuredClone(c);
  const context: AgentContext = { case: working, joiner, trigger, now };
  let model: AgentModel;
  try {
    model = buildModel(mode, context, options);
  } catch (error) {
    const result = unavailableRun(context, mode === "live" ? "anthropic" : "mock", mode === "live" ? "live-agent-model" : "deterministic-agent-model", stateHash, startedAt, "model_error", [], 0, 0, 0, [traceEntry("agent.unavailable", error instanceof Error ? error.message : "Agent model unavailable.")]);
    priorRuns.set(key, result);
    return result;
  }

  const runtime = createAgentToolRuntime(context);
  const steps: AgentStep[] = [];
  const trace: AgentTraceEntry[] = [traceEntry("agent.started", `Agent started for ${trigger} on ${c.id}.`)];
  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt(joiner, c) },
    { role: "user", content: JSON.stringify({ trigger, case_id: c.id, now }) },
  ];
  let modelSteps = 0;
  let toolCalls = 0;
  let refused = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: StopReason = "model_error";
  let modelError: string | null = null;
  let reminded = false;

  while (modelSteps < MAX_STEPS && toolCalls < MAX_TOOL_CALLS && Date.now() - Date.parse(startedAt) < MAX_RUN_MS) {
    modelSteps += 1;
    let turn;
    try {
      turn = await withTimeout(model.complete(messages, AGENT_TOOL_DEFINITIONS), MAX_MODEL_CALL_MS);
    } catch (error) {
      modelError = error instanceof Error ? error.message : "Unknown model error.";
      trace.push(traceEntry("agent.unavailable", modelError));
      break;
    }
    inputTokens += turn.usage?.input_tokens ?? 0;
    outputTokens += turn.usage?.output_tokens ?? 0;
    messages.push({ role: "assistant", content: turn.content });
    const calls = toolBlocks(turn.content);
    if (calls.length === 0) {
      // A text-only turn. Once: remind the model that every turn is a tool call. Twice: if the
      // run already proposed or escalated something, close it as an implicit finish using the
      // model's own text as the next action; otherwise it is a model error.
      const text = turn.content.find((block) => block.type === "text")?.text?.trim() ?? "";
      if (!reminded) {
        reminded = true;
        trace.push(traceEntry("agent.reminded", "Model replied with text only; reminded to call a tool or finish."));
        messages.push({ role: "user", content: "Every turn must call a tool. If the case is handled, call finish with next_action." });
        continue;
      }
      if (runtime.state.proposals.length > 0 || runtime.state.escalations_recorded > 0) {
        runtime.state.finished = true;
        runtime.state.next_action = runtime.state.next_action ?? (text.slice(0, 200) || "Review the pending proposals.");
        trace.push(traceEntry("agent.implicit_finish", "Model ended with text after proposing; run closed as finished."));
        stopReason = "finished";
        break;
      }
      modelError = "Agent model returned no tool call.";
      trace.push(traceEntry("agent.unavailable", modelError));
      break;
    }

    for (const call of calls) {
      if (toolCalls >= MAX_TOOL_CALLS) break;
      toolCalls += 1;
      const callStarted = Date.now();
      trace.push(traceEntry("agent.tool_call", `Model requested ${call.name}.`));
      let result: ToolResult;
      const permission = authorize(call.name);
      if (permission.mode !== "automatic") {
        result = permissionResult(call.name);
        refused += 1;
      } else {
        try {
          result = await runtime.dispatch(call.name, call.input);
        } catch (error) {
          modelError = error instanceof Error ? error.message : "Agent tool failed.";
          result = { status: "error", summary: `Tool ${call.name} failed: ${modelError}`, retryable: false };
        }
        if (result.status === "error" && (call.name === "propose_message" || call.name === "escalate")) refused += 1;
      }
      const elapsed = Date.now() - callStarted;
      const guardRefused = permission.mode !== "automatic"
        || result.status === "error" && (call.name === "propose_message" || call.name === "escalate");
      const step: AgentStep = {
        n: steps.length + 1,
        kind: guardRefused ? "guard.refused" : "tool",
        tool: call.name,
        args: call.input,
        result_summary: result.summary,
        ms: elapsed,
      };
      steps.push(step);
      appendCaseStep(working, guardRefused ? "guard.refused" : "agent.tool_result", result.summary, now, {
        tool: call.name,
        args: call.input,
        status: result.status,
        duration_ms: elapsed,
      });
      trace.push(traceEntry(guardRefused ? "agent.guard.refused" : "agent.tool_result", result.summary));
      if (result.status === "ok" && call.name === "propose_message") trace.push(traceEntry("agent.proposed", result.summary));
      if (result.status === "ok" && call.name === "escalate") trace.push(traceEntry("agent.escalated", result.summary));
      messages.push({ role: "user", content: [toolResultBlock(call, result)] });

      if (runtime.state.guard_refusals.get("nudge") === 2 || runtime.state.guard_refusals.get("buddy_request") === 2) {
        stopReason = "guard";
        break;
      }
      if (runtime.state.finished) {
        stopReason = "finished";
        break;
      }
      if (modelError) {
        trace.push(traceEntry("agent.unavailable", modelError));
        break;
      }
    }
    if (stopReason === "guard" || stopReason === "finished" || modelError) break;
  }

  if (stopReason !== "finished" && stopReason !== "guard") {
    if (modelError) stopReason = "model_error";
    else if (toolCalls >= MAX_TOOL_CALLS) stopReason = "tool_cap";
    else if (modelSteps >= MAX_STEPS) stopReason = "step_cap";
    else if (Date.now() - Date.parse(startedAt) >= MAX_RUN_MS) stopReason = "time_cap";
  }

  if (stopReason !== "finished") {
    const result = unavailableRun(
      context,
      model.provider,
      model.model,
      stateHash,
      startedAt,
      stopReason,
      steps,
      modelSteps,
      toolCalls,
      refused,
      trace,
      "Run assistant again.",
      inputTokens,
      outputTokens,
    );
    priorRuns.set(key, result);
    return result;
  }

  try {
    await commitRuntime(c, working, runtime, now);
  } catch (error) {
    const result = unavailableRun(
      context,
      model.provider,
      model.model,
      stateHash,
      startedAt,
      "model_error",
      steps,
      modelSteps,
      toolCalls,
      refused,
      [...trace, traceEntry("agent.unavailable", error instanceof Error ? error.message : "Agent commit failed.")],
      "Run assistant again.",
      inputTokens,
      outputTokens,
    );
    priorRuns.set(key, result);
    return result;
  }

  trace.push(traceEntry("agent.finished", runtime.state.next_action ?? "Agent finished without a further action."));
  const result: AgentRun = {
    run_id: `AGENT-RUN-${randomUUID()}`,
    trigger,
    provider: model.provider,
    model: model.model,
    steps,
    model_steps: modelSteps,
    tool_calls: toolCalls,
    refused,
    stop_reason: "finished",
    next_action: runtime.state.next_action,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costForTokens(inputTokens, outputTokens),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    proposals: runtime.state.proposals,
    availability: runtime.state.availability,
    equipment: runtime.state.equipment,
    trace,
    input_state_hash: stateHash,
  };
  priorRuns.set(key, result);
  return result;
}
