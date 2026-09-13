import { randomUUID } from "node:crypto";
import { buddyById } from "@/data/buddies";
import { personById } from "@/data/people";
import { attentionSummary } from "@/lib/attention";
import { buildContract } from "@/lib/contract";
import { findAction } from "@/lib/connectors/registry";
import { denied, failed, ok } from "@/lib/connectors/interface";
import { BUDDY_COMMITMENT } from "@/lib/policy/buddy";
import type { BuddyAvailabilityResult } from "@/lib/policy/buddy-availability";
import type { BuddyRequest, Case, Draft, EscalationCode, ToolResult } from "@/lib/types";
import { validateMessageProposal, type MessageProposalInput } from "./guards";
import type {
  AgentContext,
  AgentProposal,
  AgentRuntimeState,
  AgentToolDefinition,
} from "./types";

export const AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: "get_case_state",
    description: "Read the current joiner case, tasks, escalations, drafts, buddy status and contract completion criteria.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "check_equipment",
    description: "Read the existing laptop order. Never place a second order.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_buddy_availability",
    description: "Read eligible buddy candidates, capacity, calendar coverage and proposed slots.",
    input_schema: {
      type: "object",
      properties: { exclude_buddy_ids: { type: "array", items: { type: "string" } } },
      additionalProperties: false,
    },
  },
  {
    name: "search_policy",
    description: "Search policy pages. Use cited evidence before relying on a policy claim.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "cite_policy",
    description: "Verify a policy quote is verbatim before using it as evidence.",
    input_schema: {
      type: "object",
      properties: { page_id: { type: "string" }, quote: { type: "string" } },
      required: ["page_id", "quote"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_message",
    description: "Create one pending message draft for People approval. This tool cannot send.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["nudge", "buddy_request"] },
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        reason: { type: "string" },
        evidence: { type: "array", items: { type: "string" } },
      },
      required: ["kind", "to", "subject", "body", "reason", "evidence"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate",
    description: "Record an unresolved issue for People. This does not complete the issue.",
    input_schema: {
      type: "object",
      properties: { code: { type: "string" }, summary: { type: "string" }, evidence: { type: "array", items: { type: "string" } } },
      required: ["code", "summary", "evidence"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description: "End the run with the next human action.",
    input_schema: { type: "object", properties: { next_action: { type: "string" } }, required: ["next_action"], additionalProperties: false },
  },
];

interface EquipmentObservation {
  order_id: string;
  joiner_id: string;
  status: string;
  eta: string;
  gap_days: number;
  late: boolean;
  task_due_at: string;
  owner_id: string;
  owner_name: string;
}

export interface AgentToolRuntime {
  state: AgentRuntimeState;
  dispatch(name: string, input: Record<string, unknown>): Promise<ToolResult>;
}

function taskFor(c: Case, type: string) {
  return c.tasks.find((task) => task.type === type);
}

function dayGap(startDate: string, eta: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const delivery = Date.parse(`${eta}T00:00:00Z`);
  return Math.round((delivery - start) / 86_400_000);
}

function latestDraft(c: Case, kind: Draft["kind"]): Draft | null {
  return [...c.drafts].reverse().find((draft) => draft.kind === kind && draft.status === "pending") ?? null;
}

function attentionProjection(context: AgentContext, state: AgentRuntimeState) {
  const availability = state.availability ?? {
    joiner_id: context.joiner.id,
    start_date: context.case.start_date,
    commitment: BUDDY_COMMITMENT,
    candidates: [],
    recommendation: null,
    escalation: null,
  };
  const equipment = state.equipment?.data && typeof state.equipment.data === "object"
    ? state.equipment.data as Partial<EquipmentObservation>
    : {};
  return attentionSummary({
    case: context.case,
    facts: {
      equipment_late: equipment.late === true,
      equipment_owner_name: equipment.owner_name ?? "IT",
      start_date: context.case.start_date,
    },
    draft: latestDraft(context.case, "nudge"),
    buddy: {
      availability,
      request: context.case.buddy_requests.at(-1) ?? null,
    },
  });
}

function caseProjection(context: AgentContext, state: AgentRuntimeState) {
  const taskRows = context.case.tasks.map((task) => ({
    type: task.type,
    title: task.title,
    status: task.status,
    due_at: task.due_at,
    owner_id: task.owner_id,
    owner_name: personById(task.owner_id)?.full_name ?? task.owner_id,
  }));
  const openEscalations = context.case.escalations.filter((escalation) => !escalation.resolved_at).map((escalation) => ({
    code: escalation.code,
    severity: escalation.severity,
    summary: escalation.summary,
    evidence: escalation.evidence,
  }));
  return {
    case_id: context.case.id,
    joiner: {
      id: context.joiner.id,
      preferred_name: context.joiner.preferred_name,
      title: context.joiner.title,
      team: context.joiner.team,
      country: context.joiner.country,
      office: context.joiner.office,
      work_mode: context.joiner.work_mode,
      start_date: context.joiner.start_date,
    },
    start_date: context.case.start_date,
    tasks: taskRows,
    open_escalations: openEscalations,
    drafts: context.case.drafts.map((draft) => ({ id: draft.id, kind: draft.kind, action: draft.action, to: draft.to, status: draft.status })),
    buddy_requests: context.case.buddy_requests.map((request) => ({ id: request.id, candidate_id: request.candidate_id, status: request.status, start_date: request.start_date })),
    contract: buildContract(context.joiner, context.case.id),
    attention: attentionProjection(context, state),
  };
}

function resultData<T>(result: ToolResult): T | undefined {
  return result.data as T | undefined;
}

function validEscalationCode(value: unknown): value is EscalationCode {
  return [
    "RTW_NOT_EVIDENCED",
    "COMPLIANCE_DEADLINE_AT_RISK",
    "MANAGER_UNAVAILABLE",
    "OWNER_SLA_BREACHED",
    "NO_ELIGIBLE_BUDDY",
    "NO_AVAILABLE_BUDDY",
    "KB_NO_ANSWER",
    "UNSAFE_ACTION_ATTEMPT",
    "DUPLICATE_EVENT",
    "OUT_OF_SCOPE",
    "START_DATE_CHANGED",
  ].includes(value as string);
}

function messageInput(input: Record<string, unknown>): MessageProposalInput | null {
  if (
    (input.kind !== "nudge" && input.kind !== "buddy_request")
    || typeof input.to !== "string"
    || typeof input.subject !== "string"
    || typeof input.body !== "string"
    || typeof input.reason !== "string"
    || !Array.isArray(input.evidence)
    || input.evidence.some((item) => typeof item !== "string")
  ) return null;
  return input as unknown as MessageProposalInput;
}

function proposalBeforeApproval(draftId: string): ToolResult {
  return denied(`slack.send_message refused for pending draft ${draftId}; named People approval is required.`);
}

export function createAgentToolRuntime(context: AgentContext): AgentToolRuntime {
  const state: AgentRuntimeState = {
    equipment: null,
    availability: null,
    proposals: [],
    staged_drafts: [],
    staged_requests: [],
    staged_slots: [],
    guard_refusals: new Map(),
    next_action: null,
    finished: false,
  };

  const dispatch = async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    if (name === "get_case_state") return ok(`Read current state for ${context.case.id}.`, caseProjection(context, state));

    if (name === "check_equipment") {
      const resolved = findAction("equipment.get_order");
      if (!resolved) return failed("Equipment read action is not registered.");
      const result = await resolved.action.run({ joiner_id: context.joiner.id });
      if (result.status === "error" || result.status === "denied") return result;
      const data = resultData<{ id: string; joiner_id: string; status: string; eta: string }>(result);
      const task = taskFor(context.case, "equipment_order");
      if (!data || !task) return failed("Equipment observation is missing order or task facts.");
      const gapDays = dayGap(context.case.start_date, data.eta);
      const observation: EquipmentObservation = {
        order_id: data.id,
        joiner_id: data.joiner_id,
        status: data.status,
        eta: data.eta,
        gap_days: gapDays,
        late: gapDays > 0,
        task_due_at: task.due_at,
        owner_id: task.owner_id,
        owner_name: personById(task.owner_id)?.full_name ?? task.owner_id,
      };
      state.equipment = {
        status: result.status,
        summary: result.summary,
        data: observation,
      };
      return state.equipment;
    }

    if (name === "get_buddy_availability") {
      const resolved = findAction("buddy_directory.get_availability");
      if (!resolved) return failed("Buddy availability action is not registered.");
      const excluded = Array.isArray(input.exclude_buddy_ids)
        ? input.exclude_buddy_ids.filter((item): item is string => typeof item === "string")
        : context.case.buddy_requests.filter((request) => request.status === "declined").map((request) => request.candidate_id);
      const result = await resolved.action.run({
        joiner_id: context.joiner.id,
        start_date: context.case.start_date,
        exclude_buddy_ids: excluded,
        case_id: context.case.id,
      });
      const availability = resultData<BuddyAvailabilityResult>(result);
      if (!availability) return result;
      state.availability = availability;
      return result;
    }

    if (name === "search_policy") {
      const resolved = findAction("policy_kb.search");
      if (!resolved) return failed("Policy search action is not registered.");
      return resolved.action.run({ query: typeof input.query === "string" ? input.query : "" });
    }

    if (name === "cite_policy") {
      const resolved = findAction("policy_kb.cite");
      if (!resolved) return failed("Policy citation action is not registered.");
      return resolved.action.run({ page_id: input.page_id, quote: input.quote });
    }

    if (name === "propose_message") {
      const parsed = messageInput(input);
      if (!parsed) return failed("Message refused: proposal shape is invalid.");
      const existingProposal = state.proposals.find((proposal) => proposal.draft.kind === (parsed.kind === "nudge" ? "nudge" : "buddy_intro"));
      if (existingProposal) return failed(`Message refused: ${parsed.kind} already has a pending proposal in this run.`);
      const equipmentTask = taskFor(context.case, "equipment_order");
      if (!equipmentTask) return failed("Message refused: equipment task is missing.");
      const guard = validateMessageProposal(parsed, {
        case: context.case,
        joiner: context.joiner,
        equipmentTask,
        equipmentEta: state.equipment?.data && typeof state.equipment.data === "object" ? String((state.equipment.data as EquipmentObservation).eta) : undefined,
        availability: state.availability,
        allowed_dates: new Set([context.case.start_date, context.joiner.start_date]),
      });
      if (!guard.ok) {
        const attempts = (state.guard_refusals.get(parsed.kind) ?? 0) + 1;
        state.guard_refusals.set(parsed.kind, attempts);
        return failed(guard.summary);
      }
      const draft: Draft = {
        id: `DRAFT-${randomUUID()}`,
        case_id: context.case.id,
        kind: guard.message.kind,
        action: "slack.send_message",
        channel: "slack",
        to: guard.message.to,
        subject: guard.message.subject,
        body: guard.message.body,
        status: "pending",
        created_at: context.now,
      };
      const request = guard.message.kind === "buddy_intro" && state.availability
        ? (() => {
          const assessment = state.availability!.candidates.find((candidate) => candidate.candidate.id === guard.message.to);
          if (!assessment) return undefined;
          const buddyRequest: BuddyRequest = {
            id: `BUDDY-REQ-${randomUUID()}`,
            case_id: context.case.id,
            draft_id: draft.id,
            candidate_id: guard.message.to,
            start_date: context.case.start_date,
            slots: assessment.availability.slots.slice(0, 2).map((slot) => ({ ...slot })),
            status: "pending_approval",
            created_at: context.now,
          };
          return buddyRequest;
        })()
        : undefined;
      context.case.drafts.push({ ...draft });
      state.staged_drafts.push(draft);
      if (request) {
        context.case.buddy_requests.push(request);
        state.staged_requests.push(request);
        const buddyTask = taskFor(context.case, "buddy_allocation");
        if (buddyTask) {
          buddyTask.status = "waiting_approval";
          buddyTask.detail = `Buddy request ${request.id} awaits People approval for ${buddyById(request.candidate_id)?.full_name ?? request.candidate_id}.`;
        }
      }
      const proposal: AgentProposal = {
        draft,
        before_approval: proposalBeforeApproval(draft.id),
        reason: parsed.reason,
        evidence: [...parsed.evidence],
        request,
      };
      state.proposals.push(proposal);
      return ok(`Pending ${parsed.kind} draft ${draft.id} created for approval.`, {
        draft_id: draft.id,
        status: "pending",
        before_approval: proposal.before_approval,
        request_id: request?.id,
      });
    }

    if (name === "escalate") {
      if (!validEscalationCode(input.code) || typeof input.summary !== "string" || !Array.isArray(input.evidence)) {
        return failed("Escalation refused: code, summary and evidence are required.");
      }
      const existing = context.case.escalations.find((escalation) => escalation.code === input.code && !escalation.resolved_at);
      if (existing) return ok(`Escalation ${existing.id} already exists.`, { escalation_id: existing.id });
      const escalation = {
        id: `${context.case.id}-E-agent-${randomUUID()}`,
        case_id: context.case.id,
        code: input.code,
        severity: input.code === "RTW_NOT_EVIDENCED" ? "critical" as const : "warn" as const,
        to_function: "people" as const,
        summary: input.summary,
        evidence: input.evidence.filter((item): item is string => typeof item === "string"),
        raised_at: context.now,
      };
      context.case.escalations.push(escalation);
      return ok(`Escalation ${escalation.id} recorded for People.`, { escalation_id: escalation.id });
    }

    if (name === "finish") {
      state.finished = true;
      state.next_action = typeof input.next_action === "string" ? input.next_action : null;
      return ok("Agent run finished.", { next_action: state.next_action });
    }

    return denied(`Tool ${name} is not available to this agent.`);
  };

  return { state, dispatch };
}
