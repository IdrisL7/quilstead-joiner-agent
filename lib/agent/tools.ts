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
    description: "Read the current joiner case, tasks, escalations, drafts, buddy status and contract completion criteria. Task owner ids here are task owners, not buddy candidates.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "check_equipment",
    description: "Read the existing laptop order. Never place a second order.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "get_buddy_availability",
    description: "Read eligible buddy candidates with their candidate_id, capacity, availability status and proposed slots. Only a candidate with availability status \"available\" can receive a buddy_request; prefer the recommendation. If none is available, escalate NO_ELIGIBLE_BUDDY.",
    input_schema: {
      type: "object",
      properties: { exclude_buddy_ids: { type: "array", items: { type: "string" } } },
      required: [],
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
    description: "Create one pending message draft for People approval. This tool cannot send. kind=nudge: `to` is the owner_id of an open task on the case (from get_case_state or check_equipment); a nudge to the equipment owner about a late laptop must ask for a loaner or earlier delivery. kind=buddy_request: `to` is the recommendation's candidate_id from get_buddy_availability, or another candidate whose availability status is exactly \"available\"; never unknown, busy, error, a People partner or a manager. Use only dates shown in tool results.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["nudge", "buddy_request"] },
        to: { type: "string", description: "nudge: owner_id of an open task. buddy_request: candidate_id with availability status available." },
        subject: { type: "string" },
        body: { type: "string" },
        reason: { type: "string" },
        evidence: { type: "array", items: { type: "string" } },
      },
      required: ["kind", "to", "subject", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate",
    description: "Record an unresolved issue for People. This does not complete the issue.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", enum: ["RTW_NOT_EVIDENCED", "COMPLIANCE_DEADLINE_AT_RISK", "MANAGER_UNAVAILABLE", "OWNER_SLA_BREACHED", "NO_ELIGIBLE_BUDDY", "KB_NO_ANSWER", "UNSAFE_ACTION_ATTEMPT", "START_DATE_CHANGED"], description: "Use only these codes. NO_ELIGIBLE_BUDDY covers no eligible or no available buddy." },
        summary: { type: "string" },
        evidence: { type: "array", items: { type: "string" } },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description: "End the run. next_action is one sentence, under 200 characters, naming the single next human action (for example: approve the pending nudge and buddy request). Do not summarise the case.",
    input_schema: { type: "object", properties: { next_action: { type: "string", description: "One sentence, under 200 characters." } }, required: ["next_action"], additionalProperties: false },
  },
];

interface EquipmentObservation {
  pending_nudge_exists?: boolean; // true when a pending nudge already waits for approval; superseded drafts do not count
  nudge_needed?: boolean;
  hint?: string;
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
    drafts: context.case.drafts.map((draft) => ({
      id: draft.id,
      kind: draft.kind,
      action: draft.action,
      to: draft.to,
      status: draft.decided_by === "system" || draft.decision_reason?.startsWith("superseded") ? "superseded" : draft.status,
      decided_by: draft.decided_by ?? null,
      pending: draft.status === "pending",
    })),
    drafts_note: "Only pending drafts await approval. superseded = invalidated by a fact change, not a People decision; if the risk still holds, propose again. rejected = a People decision; do not re-propose the same message.",
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
  ) return null;
  const reason = typeof input.reason === "string" ? input.reason : "";
  const evidence = Array.isArray(input.evidence)
    ? input.evidence.filter((item): item is string => typeof item === "string")
    : typeof input.evidence === "string" ? [input.evidence] : [];
  return { kind: input.kind, to: input.to.trim(), subject: input.subject, body: input.body, reason, evidence } as MessageProposalInput;
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
    escalations_recorded: 0,
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
        pending_nudge_exists: context.case.drafts.some((draft) => draft.kind === "nudge" && draft.status === "pending"),
      };
      observation.nudge_needed = observation.late && !observation.pending_nudge_exists;
      observation.hint = observation.nudge_needed
        ? `Laptop arrives ${observation.eta}, after the ${context.case.start_date} start, and no pending nudge exists. Propose a nudge to ${observation.owner_id} asking for a loaner or earlier delivery.`
        : observation.late ? "A pending nudge already awaits approval; do not propose another." : "Equipment arrives before the start date; no nudge needed.";
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
      // The model sees the ranked top six; the guard allowlist keeps the full observation.
      return { ...result, data: { ...availability, candidates: availability.candidates.slice(0, 6), candidates_total: availability.candidates.length } };
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
      if (!parsed) return failed(`Message refused: proposal shape is invalid. Received keys: ${Object.keys(input).join(", ") || "none"}; kind=${String(input.kind)}. Required: kind (nudge|buddy_request), to, subject, body.`);
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
        equipmentLate: state.equipment?.data && typeof state.equipment.data === "object" ? (state.equipment.data as EquipmentObservation).late === true : undefined,
        allowed_dates: new Set([context.case.start_date, context.joiner.start_date, context.now.slice(0, 10)]),
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
      if (!validEscalationCode(input.code)) {
        return failed(`Escalation refused: code must be one of the listed EscalationCode values. Received code=${String(input.code)}.`);
      }
      const existing = context.case.escalations.find((escalation) => escalation.code === input.code && !escalation.resolved_at);
      if (existing) return ok(`Escalation ${existing.id} already exists.`, { escalation_id: existing.id });
      const escalation = {
        id: `${context.case.id}-E-agent-${randomUUID()}`,
        case_id: context.case.id,
        code: input.code,
        severity: input.code === "RTW_NOT_EVIDENCED" ? "critical" as const : "warn" as const,
        to_function: "people" as const,
        summary: typeof input.summary === "string" && input.summary.trim() ? input.summary.trim() : `${String(input.code)} recorded by the assistant.`,
        evidence: Array.isArray(input.evidence) ? input.evidence.filter((item): item is string => typeof item === "string") : [],
        raised_at: context.now,
      };
      context.case.escalations.push(escalation);
      state.escalations_recorded += 1;
      return ok(`Escalation ${escalation.id} recorded for People.`, { escalation_id: escalation.id });
    }

    if (name === "finish") {
      state.finished = true;
      const raw = typeof input.next_action === "string" ? input.next_action.replace(/\s+/g, " ").trim() : "";
      // Keep the model's wording when it is already short. Long summaries collapse to the first
      // sentence so the Overview banner stays one line and the panel reads an action, not a report.
      const firstSentence = raw.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? raw;
      state.next_action = !raw ? null : raw.length <= 240 ? raw : firstSentence.length <= 240 ? firstSentence : `${raw.slice(0, 237)}...`;
      return ok("Agent run finished.", { next_action: state.next_action });
    }

    return denied(`Tool ${name} is not available to this agent.`);
  };

  return { state, dispatch };
}
