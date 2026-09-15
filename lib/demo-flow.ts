import { randomUUID } from "node:crypto";
import { buddyById } from "@/data/buddies";
import { buddyCalendarById } from "@/data/buddy-calendars";
import { EVENTS } from "@/data/events";
import { joinerById } from "@/data/joiners";
import { personById } from "@/data/people";
import { authorize } from "@/lib/permissions";
import { findAction } from "@/lib/connectors/registry";
import { failed } from "@/lib/connectors/interface";
import { loadKb } from "@/lib/connectors/simulated/policy-kb";
import {
  releaseBuddyCapacity,
  reserveBuddyCapacity,
  setSimulatedBuddyCalendar,
} from "@/lib/connectors/simulated/buddy-directory";
import {
  approveDraft,
  discardDraft,
  rejectDraft,
  registerDraft,
  supersedeDraft,
} from "@/lib/connectors/simulated/messaging";
import type { NudgeModelDraft } from "@/lib/model";
import { CaseStore } from "@/lib/store/case-store";
import { resetDemoState } from "@/lib/store/demo-state";
import { currentJoinerById } from "@/lib/store/joiner-store";
import { deriveState } from "@/lib/state-machine";
import { isWeekend } from "@/lib/policy/dates";
import type { BuddyAvailabilityResult } from "@/lib/policy/buddy-availability";
import type { BuddyRequest, Case, Draft, HrisEvent, Joiner, ManagerPlanRequest, ToolResult } from "@/lib/types";
import { runAgent } from "@/lib/agent/loop";
import { AGENT_TOOL_DEFINITIONS } from "@/lib/agent/tools";
import type { AgentRun } from "@/lib/agent/types";
import type { EquipmentSourceObservation } from "@/lib/connectors/simulated/equipment";

const DEMO_NOW = "2026-09-30T09:00:00Z";
const DEMO_JOINER_ID = "J-004";
const EQUIPMENT_POLICY_ID = "equipment-policy";
const EQUIPMENT_POLICY_QUOTE = "IT orders equipment within five working days of the contract being signed.";

export type DemoDecision = "approve" | "reject";
export type BuddyApprovalDecision = "approve" | "reject";
export type BuddyResponseDecision = "accepted" | "declined";

export interface DemoTraceEntry {
  actor: "system" | "agent" | "human";
  kind: string;
  summary: string;
}

export interface DemoFacts {
  contract_event_id: string;
  contract_signed_at: string;
  equipment_task_due_at: string;
  equipment_task_title: string;
  equipment_owner_id: string;
  equipment_owner_name: string;
  start_date: string;
  equipment_eta: string;
  gap_days: number;
  equipment_late: boolean;
  policy_page_id: string;
  policy_quote: string;
  approval_required: string;
}

export interface DemoDateChange {
  previous_start_date: string;
  new_start_date: string;
  risk_before: boolean;
  risk_after: boolean;
  deadlines_changed: number;
  tasks_changed: number;
  tasks_unchanged: number;
  tasks_added: number;
  superseded_draft_id?: string;
  superseded_buddy_request_id?: string;
}

export interface DemoDraftUnavailable {
  message: string;
}

export interface DemoPreparation {
  run_id: string;
  case: Case;
  event: HrisEvent;
  joiner: Joiner;
  model: Pick<NudgeModelDraft, "provider" | "model">;
  agent?: AgentRun;
  agent_trace_run_id?: string;
  draft: Draft | null;
  equipment: ToolResult;
  equipment_observation: EquipmentSourceObservation;
  beforeApproval: ToolResult | null;
  facts: DemoFacts;
  buddy: DemoBuddyState;
  decision?: DemoDecision;
  afterApproval?: ToolResult;
  date_change?: DemoDateChange;
  draft_unavailable?: DemoDraftUnavailable;
  trace: DemoTraceEntry[];
  store: CaseStore;
}

export interface DemoResolution {
  run_id: string;
  decision: DemoDecision;
  case: Case;
  joiner: Joiner;
  model: Pick<NudgeModelDraft, "provider" | "model">;
  draft: Draft;
  equipment: ToolResult;
  equipment_observation: EquipmentSourceObservation;
  beforeApproval: ToolResult;
  afterApproval: ToolResult;
  facts: DemoFacts;
  buddy: DemoBuddyState;
  date_change?: DemoDateChange;
  draft_unavailable?: DemoDraftUnavailable;
  trace: DemoTraceEntry[];
}

export interface DemoBuddyState {
  availability: BuddyAvailabilityResult;
  request: BuddyRequest | null;
  draft: Draft | null;
  beforeApproval: ToolResult | null;
  afterApproval?: ToolResult;
}

export interface DemoBuddyActionResult {
  preparation: DemoPreparation;
  conflict?: string;
  duplicate?: boolean;
}

export interface DemoRun extends Omit<DemoPreparation, "draft" | "beforeApproval"> {
  draft: Draft;
  beforeApproval: ToolResult;
  approved: boolean;
  afterApproval: ToolResult;
  retry: ToolResult;
}

const MAX_DRAFT_SUBJECT_LENGTH = 160;
const MAX_DRAFT_BODY_LENGTH = 700;

const ACTIVE_BUDDY_REQUEST_STATUSES = new Set<BuddyRequest["status"]>([
  "pending_approval",
  "awaiting_acceptance",
  "accepted",
  "confirmed",
]);

export class BuddyFlowConflict extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
  }
}

export class EquipmentApprovalConflict extends BuddyFlowConflict {
  constructor(message: string, readonly preparation: DemoPreparation) {
    super(message);
  }
}

// A request the caller can fix: bad or nonsensical input. Distinct from a conflict (409) and
// from an internal failure (500).
export class DemoInputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
  }
}

function formatIsoDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

// Start dates are validated as a People partner would: a real calendar day, a working day, and
// not before the case clock. Public holidays are not modelled anywhere in this build.
export function validateStartDate(value: string, now = DEMO_NOW): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "start_date must be an ISO date (YYYY-MM-DD).";
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return `${value} is not a real calendar date.`;
  }
  if (isWeekend(date)) return `${formatIsoDate(value)} is a ${date.getUTCDay() === 6 ? "Saturday" : "Sunday"}. Choose a working day (Monday to Friday).`;
  if (value < now.slice(0, 10)) return `${formatIsoDate(value)} is before the case clock (${formatIsoDate(now.slice(0, 10))}). Choose a date on or after it.`;
  return null;
}

function requireAction(tool: string) {
  const resolved = findAction(tool);
  if (!resolved) throw new Error(`Demo action is not registered: ${tool}`);
  return resolved;
}

function nextRunId(): string {
  return `DEMO-RUN-${randomUUID()}`;
}

function agentTraceEntries(agent: AgentRun, availability: BuddyAvailabilityResult): DemoTraceEntry[] {
  let proposalIndex = 0;
  const availabilitySummary = availability.recommendation
    ? `Recommended ${availability.recommendation.candidate_name} from the current first-week calendar snapshot.`
    : availability.escalation?.summary ?? "No buddy recommendation is available from the current facts.";
  return agent.trace.flatMap((entry) => {
    const entries: DemoTraceEntry[] = [entry];
    if (entry.kind === "agent.tool_result" && entry.summary.startsWith("Access request ")) {
      entries.push({ actor: "agent", kind: "tool.identity.request_access", summary: entry.summary });
    }
    if (entry.kind === "agent.tool_result" && (entry.summary.startsWith("Recommended") || entry.summary.startsWith("No suitable buddy"))) {
      entries.push({ actor: "agent", kind: "tool.buddy_directory.get_availability", summary: availabilitySummary });
    }
    if (entry.kind === "agent.proposed") {
      const proposal = agent.proposals[proposalIndex++];
        if (proposal) {
          entries.push({ actor: "agent", kind: proposal.request ? "buddy.request.prepared" : "draft.created", summary: proposal.request
          ? `Prepared a buddy request for ${proposal.request.candidate_id} with two proposed first-week slots (draft ${proposal.draft.id}).`
          : `Draft ${proposal.draft.id} created for ${proposal.draft.action} and awaits approval.` });
        if (proposal.request) entries.push({ actor: "agent", kind: "draft.created", summary: `Draft ${proposal.draft.id} created for the buddy request and awaits People approval.` });
        entries.push({ actor: "system", kind: "send.refused", summary: `${proposal.request ? "Buddy request" : "Equipment nudge"} draft ${proposal.draft.id}: ${proposal.before_approval.summary}` });
      }
    }
    return entries;
  });
}

function agentUnavailableMessage(agent: AgentRun): DemoDraftUnavailable {
  return { message: `Assistant unavailable (${agent.stop_reason}). The case and dates are current, no message was sent, and you can run assistant again to retry drafting.` };
}

function applyAgentRun(preparation: DemoPreparation, agent: AgentRun): DemoPreparation {
  const availability = agent.availability ?? preparation.buddy.availability;
  const equipmentProposal = agent.proposals.find((proposal) => proposal.draft.kind === "nudge" && proposal.draft.workstream !== "manager");
  const buddyProposal = agent.proposals.find((proposal) => proposal.draft.kind === "buddy_intro");
  const latestRequest = latestBuddyRequest(preparation.case);
  const preservesCurrentBuddy = latestRequest?.id === preparation.buddy.request?.id;
  const buddyDraft = buddyProposal?.draft ?? (preservesCurrentBuddy ? preparation.buddy.draft : null);
  const buddyBeforeApproval = buddyProposal?.before_approval ?? (preservesCurrentBuddy ? preparation.buddy.beforeApproval : null);
  const buddyAfterApproval = preservesCurrentBuddy ? preparation.buddy.afterApproval : undefined;

  return {
    ...preparation,
    run_id: nextRunId(),
    agent,
    model: { provider: agent.provider, model: agent.model },
    draft: equipmentProposal?.draft ?? preparation.draft,
    beforeApproval: equipmentProposal?.before_approval ?? preparation.beforeApproval,
    buddy: buddyState(availability, buddyProposal?.request ?? latestRequest, buddyDraft, buddyBeforeApproval, buddyAfterApproval),
    draft_unavailable: agent.stop_reason === "finished" ? undefined : agentUnavailableMessage(agent),
    // An idempotent re-run returns the same run id; its trace rows are already in the trail.
    agent_trace_run_id: agent.run_id,
    trace: preparation.agent_trace_run_id === agent.run_id
      ? preparation.trace
      : [...preparation.trace, ...agentTraceEntries(agent, availability)],
  };
}

function recordCaseStep(c: Case, actor: "system" | "agent" | "human", kind: string, summary: string, at: string, data?: Record<string, unknown>): void {
  c.steps.push({
    id: `${c.id}-S-${String(c.steps.length + 1).padStart(4, "0")}`,
    case_id: c.id,
    at,
    actor,
    kind,
    summary,
    data,
  });
}

function latestBuddyRequest(c: Case): BuddyRequest | null {
  return c.buddy_requests.at(-1) ?? null;
}

function declinedBuddyIds(c: Case): string[] {
  return c.buddy_requests
    .filter((request) => request.status === "declined")
    .map((request) => request.candidate_id);
}

function buddyTask(c: Case) {
  return c.tasks.find((task) => task.type === "buddy_allocation");
}

function updateBuddyTask(c: Case, status: "open" | "waiting_approval" | "done", detail: string, doneBy?: string, doneAt?: string): void {
  const task = buddyTask(c);
  if (!task) throw new Error("Demo buddy allocation task is missing from the plan");
  task.status = status;
  task.detail = detail;
  if (status === "done") {
    task.done_by = doneBy;
    task.done_at = doneAt;
  } else {
    delete task.done_by;
    delete task.done_at;
  }
}

function buddyName(candidateId: string): string {
  return buddyById(candidateId)?.full_name ?? candidateId;
}

function readBuddyResult(result: ToolResult): BuddyAvailabilityResult {
  if (!result.data || typeof result.data !== "object" || !("candidates" in result.data) || !("commitment" in result.data)) {
    throw new Error("Buddy availability result did not include the expected assessment");
  }
  return result.data as BuddyAvailabilityResult;
}

async function readBuddyAvailability(joiner: Joiner, startDate: string, excludedBuddyIds: string[] = [], caseId?: string): Promise<BuddyAvailabilityResult> {
  const tool = "buddy_directory.get_availability";
  if (authorize(tool).mode !== "automatic") throw new Error(`${tool} is not automatic`);
  const action = requireAction(tool);
  const result = await action.action.run({ joiner_id: joiner.id, start_date: startDate, exclude_buddy_ids: excludedBuddyIds, case_id: caseId });
  if (result.status === "error" || result.status === "denied") throw new Error(result.summary);
  return readBuddyResult(result);
}

function sameSlots(left: BuddyRequest["slots"], right: BuddyRequest["slots"]): boolean {
  return left.length === right.length && left.every((slot, index) => {
    const other = right[index];
    return other
      && slot.id === other.id
      && slot.kind === other.kind
      && slot.start_at === other.start_at
      && slot.end_at === other.end_at
      && slot.timezone === other.timezone
      && slot.duration_minutes === other.duration_minutes;
  });
}

function availabilityMatchesRequest(availability: BuddyAvailabilityResult, request: BuddyRequest): boolean {
  const candidate = availability.candidates.find((assessment) => assessment.candidate.id === request.candidate_id);
  return availability.start_date === request.start_date
    && candidate?.eligibility.eligible === true
    && candidate.availability.status === "available"
    && sameSlots(request.slots, candidate.availability.slots);
}

function updateCaseDraftFromTrustedState(c: Case, draftId: string, status: Draft["status"], decidedBy?: string, decidedAt?: string, reason?: string): Draft {
  const draft = c.drafts.find((candidate) => candidate.id === draftId);
  if (!draft) throw new Error(`Demo case draft is missing: ${draftId}`);
  draft.status = status;
  draft.decided_by = decidedBy;
  draft.decided_at = decidedAt;
  draft.decision_reason = reason;
  return draft;
}

function invalidateBuddyRequest(c: Case, request: BuddyRequest, now: string, reason: string): void {
  if (request.status === "pending_approval") {
    supersedeDraft(request.draft_id, now, reason);
    updateCaseDraftFromTrustedState(c, request.draft_id, "rejected", undefined, now, reason);
  }
  if (request.status === "confirmed") {
    // A confirmed allocation holds one of the buddy's capacity slots; invalidating it returns the
    // slot and clears the case's buddy so the next recommendation is computed from current facts.
    releaseBuddyCapacity(c.id, request.candidate_id);
    if (c.buddy_id === request.candidate_id) c.buddy_id = undefined;
  }
  request.status = "superseded";
  request.invalidated_at = now;
  request.invalidation_reason = reason;
  updateBuddyTask(c, "open", reason);
  recordCaseStep(c, "system", "buddy.request.invalidated", `Buddy request ${request.id} for ${buddyName(request.candidate_id)} was invalidated. ${reason}`, now, {
    request_id: request.id,
    draft_id: request.draft_id,
    candidate_id: request.candidate_id,
  });
}

function buddyState(
  availability: BuddyAvailabilityResult,
  request: BuddyRequest | null,
  draft: Draft | null = null,
  beforeApproval: ToolResult | null = null,
  afterApproval?: ToolResult,
): DemoBuddyState {
  return { availability, request, draft, beforeApproval, afterApproval };
}

function traceFromCase(c: Case): DemoTraceEntry[] {
  return c.steps.map((step) => ({ actor: step.actor, kind: step.kind, summary: step.summary }));
}

function updateCaseDraft(c: Case, draftId: string, decision: DemoDecision, decidedBy: string, decidedAt: string): Draft {
  const draft = c.drafts.find((candidate) => candidate.id === draftId);
  if (!draft) throw new Error(`Demo case draft is missing: ${draftId}`);
  draft.status = decision === "approve" ? "approved" : "rejected";
  draft.decided_by = decidedBy;
  draft.decided_at = decidedAt;
  draft.decision_reason = decision === "reject" ? "Rejected in the approval screen." : undefined;
  return draft;
}

function markCaseDraftSuperseded(c: Case, draftId: string, decidedAt: string, reason: string): Draft {
  const draft = c.drafts.find((candidate) => candidate.id === draftId);
  if (!draft) throw new Error(`Demo case draft is missing: ${draftId}`);
  draft.status = "rejected";
  draft.decided_by = "system";
  draft.decided_at = decidedAt;
  draft.decision_reason = `superseded: ${reason}`;
  return draft;
}

function calendarDayGap(startDate: string, eta: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const delivery = Date.parse(`${eta}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(delivery)) throw new Error("Demo facts contain an invalid date");
  return Math.round((delivery - start) / 86_400_000);
}

function equipmentData(equipment: ToolResult): { eta: string; status: string } {
  if (!equipment.data || typeof equipment.data !== "object" || !("eta" in equipment.data)) {
    throw new Error("Demo equipment result did not include an ETA");
  }
  return { eta: String(equipment.data.eta), status: "status" in equipment.data ? String(equipment.data.status) : equipment.status };
}

function equipmentObservation(equipment: ToolResult): EquipmentSourceObservation {
  if (!equipment.data || typeof equipment.data !== "object") throw new Error("Equipment source observation is missing.");
  const data = equipment.data as Record<string, unknown>;
  if (typeof data.order_id !== "string" || typeof data.joiner_id !== "string" || typeof data.eta !== "string"
    || (data.status !== "ordered" && data.status !== "backordered") || !Number.isInteger(data.source_revision)
    || typeof data.signature !== "string") {
    throw new Error("Equipment source observation is malformed.");
  }
  return {
    order_id: data.order_id,
    joiner_id: data.joiner_id,
    eta: data.eta,
    status: data.status,
    source_revision: data.source_revision as number,
    signature: data.signature,
  };
}

export async function readEquipmentSource(joinerId: string): Promise<{ result: ToolResult; observation: EquipmentSourceObservation }> {
  const result = await requireAction("equipment.get_order").action.run({ joiner_id: joinerId });
  if (result.status === "error" || result.status === "denied") throw new Error(result.summary);
  return { result, observation: equipmentObservation(result) };
}

export function sameEquipmentObservation(left: EquipmentSourceObservation, right: EquipmentSourceObservation): boolean {
  return left.signature === right.signature && left.source_revision === right.source_revision;
}

export function buildDemoFacts(c: Case, event: HrisEvent, joiner: Joiner, equipment: ToolResult): DemoFacts {
  const task = c.tasks.find((candidate) => candidate.type === "equipment_order");
  if (!task) throw new Error("Demo equipment task is missing from the plan");
  const policy = loadKb().find((page) => page.id === EQUIPMENT_POLICY_ID);
  if (!policy || !policy.body.includes(EQUIPMENT_POLICY_QUOTE)) throw new Error("Demo equipment policy evidence is missing");
  const { eta } = equipmentData(equipment);
  const gapDays = calendarDayGap(c.start_date, eta);
  return {
    contract_event_id: event.event_id,
    contract_signed_at: event.occurred_at,
    equipment_task_due_at: task.due_at,
    equipment_task_title: task.title,
    equipment_owner_id: task.owner_id,
    equipment_owner_name: personById(task.owner_id)?.full_name ?? task.owner_id,
    start_date: c.start_date,
    equipment_eta: eta,
    gap_days: gapDays,
    equipment_late: gapDays > 0,
    policy_page_id: EQUIPMENT_POLICY_ID,
    policy_quote: EQUIPMENT_POLICY_QUOTE,
    approval_required: "Human approval is required before slack.send_message.",
  };
}

function modelMetadata(mode: string): Pick<NudgeModelDraft, "provider" | "model"> {
  return mode === "live"
    ? { provider: "anthropic", model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001" }
    : { provider: "mock", model: "deterministic-demo-model" };
}

export async function prepareDemo(
  now = DEMO_NOW,
  mode = process.env.DEMO_MODE ?? "mock",
  joinerId = DEMO_JOINER_ID,
  store = new CaseStore(),
): Promise<DemoPreparation> {
  const runId = nextRunId();

  const event = EVENTS.find((candidate) => candidate.joiner_id === joinerId
    && candidate.type === "contract.signed"
    && candidate.payload.redelivery !== true);
  if (!event) throw new Error(`Demo contract event is not registered for joiner: ${joinerId}`);
  const joiner = joinerById(event.joiner_id);
  if (!joiner) throw new Error(`Demo joiner is not registered: ${event.joiner_id}`);

  const opened = store.open(event, joiner, now);
  if (!opened.case || !["opened", "duplicate"].includes(opened.outcome) || opened.case.event_id !== event.event_id) {
    throw new Error(`Demo case did not open: ${opened.outcome}`);
  }
  const c = opened.case;
  const trace = traceFromCase(c);

  const equipmentAction = requireAction("equipment.order");
  if (authorize("equipment.order").mode !== "automatic") throw new Error("Demo equipment action is not automatic");
  let equipment = opened.outcome === "duplicate"
    ? await requireAction("equipment.get_order").action.run({ joiner_id: joiner.id })
    : failed("No existing equipment order", true);
  if (equipment.status === "error" || equipment.status === "denied") {
    equipment = await equipmentAction.action.run({
      joiner_id: joiner.id,
      model: joiner.equipment_preference,
      ship_to: joiner.work_mode === "remote" ? "home" : "office",
      now,
    });
  }
  if (equipment.status === "error" || equipment.status === "denied") throw new Error(equipment.summary);
  if (!c.steps.some((step) => step.kind === "tool.equipment.order")) {
    recordCaseStep(c, "agent", "tool.equipment.order", equipment.summary, now, { status: equipment.status });
    trace.push({ actor: "agent", kind: "tool.equipment.order", summary: equipment.summary });
  }
  const facts = buildDemoFacts(c, event, joiner, equipment);
  const sourceObservation = equipmentObservation(equipment);
  const agent = await runAgent(c, joiner, "contract.signed", now, mode === "live" ? "live" : "mock");
  const availability = agent.availability ?? await readBuddyAvailability(joiner, c.start_date, [], c.id);
  const base: DemoPreparation = {
    run_id: runId,
    case: c,
    event,
    joiner,
    agent,
    model: { provider: agent.provider, model: agent.model },
    draft: null,
    equipment,
    equipment_observation: sourceObservation,
    beforeApproval: null,
    facts,
    buddy: buddyState(availability, null),
    trace,
    store,
  };
  return applyAgentRun(base, agent);
}

export async function changeDemoStartDate(
  preparation: DemoPreparation,
  newStartDate: string,
  mode = process.env.DEMO_MODE ?? "mock",
  now = DEMO_NOW,
): Promise<DemoPreparation> {
  const invalid = validateStartDate(newStartDate, now);
  if (invalid) throw new DemoInputError(invalid);
  const previousStartDate = preparation.case.start_date;
  if (newStartDate === previousStartDate) {
    if (!preparation.draft_unavailable) throw new DemoInputError("Choose a different start date to recalculate the case.");
    return retryAgent(preparation, mode, now);
  }

  const currentManagerPlan = latestManagerPlan(preparation.case);
  if (currentManagerPlan && ACTIVE_MANAGER_PLAN_STATUSES.has(currentManagerPlan.status)) {
    invalidateManagerPlan(preparation.case, currentManagerPlan, now, "Start date changed; the manager must reconfirm the first-day plan.");
  }

  // Only a draft still waiting for a decision is superseded. An approved and sent draft is
  // history: it stays approved in the trail, and the re-run proposes a fresh nudge if the risk
  // still holds against the new date.
  const supersededDraftId = preparation.draft?.status === "pending" ? preparation.draft.id : undefined;
  if (supersededDraftId) {
    const reason = "Superseded by a start-date change before approval.";
    if (!supersedeDraft(supersededDraftId, now, reason)) throw new Error(`Demo draft could not be superseded: ${supersededDraftId}`);
    markCaseDraftSuperseded(preparation.case, supersededDraftId, now, reason);
  }

  const supersededBuddyRequest = latestBuddyRequest(preparation.case);
  const supersededBuddyRequestId = supersededBuddyRequest && ACTIVE_BUDDY_REQUEST_STATUSES.has(supersededBuddyRequest.status)
    ? supersededBuddyRequest.id
    : undefined;
  if (supersededBuddyRequestId && supersededBuddyRequest) {
    invalidateBuddyRequest(preparation.case, supersededBuddyRequest, now, "Start date changed before the buddy commitment was revalidated.");
  }

  const event: HrisEvent = {
    event_id: `DEMO-START-${randomUUID()}`,
    type: "joiner.start_date_changed",
    occurred_at: now,
    joiner_id: preparation.joiner.id,
    payload: { previous_start_date: previousStartDate, start_date: newStartDate, reason: "Changed in the demo control." },
  };
  const currentJoiner = currentJoinerById(preparation.joiner.id) ?? preparation.joiner;
  const recomputed = preparation.store.applyStartDateChange(event, currentJoiner, now);
  if (!recomputed.case) throw new Error(`Demo case was not found for ${preparation.joiner.id}`);
  const updatedJoiner = currentJoinerById(preparation.joiner.id) ?? { ...currentJoiner, start_date: newStartDate };
  const facts = buildDemoFacts(recomputed.case, preparation.event, updatedJoiner, preparation.equipment);
  const availability = await readBuddyAvailability(updatedJoiner, newStartDate, declinedBuddyIds(recomputed.case), recomputed.case.id);
  const dateChange: DemoDateChange = {
    previous_start_date: previousStartDate,
    new_start_date: newStartDate,
    risk_before: preparation.facts.equipment_late,
    risk_after: facts.equipment_late,
    deadlines_changed: recomputed.deadlineChanged,
    tasks_changed: recomputed.changed,
    tasks_unchanged: recomputed.unchanged,
    tasks_added: recomputed.added,
    superseded_draft_id: supersededDraftId,
    superseded_buddy_request_id: supersededBuddyRequestId,
  };
  const trace = [
    ...preparation.trace,
    { actor: "system" as const, kind: "start_date.changed", summary: `Start date ${previousStartDate} -> ${newStartDate}; ${recomputed.deadlineChanged} deadlines moved and ${recomputed.changed} tasks reconciled.` },
    ...(supersededDraftId ? [{ actor: "system" as const, kind: "draft.superseded", summary: `Draft ${supersededDraftId} is unavailable after the start-date change.` }] : []),
    ...(supersededBuddyRequestId ? [{ actor: "system" as const, kind: "buddy.request.superseded", summary: `Buddy request ${supersededBuddyRequestId} is unavailable after the start-date change.` }] : []),
  ];

  const base: DemoPreparation = {
    ...preparation,
    run_id: nextRunId(),
    case: recomputed.case,
    joiner: updatedJoiner,
    model: modelMetadata(mode),
    draft: null,
    beforeApproval: null,
    decision: undefined,
    afterApproval: undefined,
    facts,
    buddy: buddyState(availability, latestBuddyRequest(recomputed.case)),
    date_change: dateChange,
    draft_unavailable: undefined,
    trace,
  };
  const agent = await runAgent(recomputed.case, updatedJoiner, "start_date_changed", now, mode === "live" ? "live" : "mock");
  return applyAgentRun(base, agent);
}

export async function retryAgent(
  preparation: DemoPreparation,
  mode = process.env.DEMO_MODE ?? "mock",
  now = DEMO_NOW,
): Promise<DemoPreparation> {
  if (!preparation.draft_unavailable) throw new DemoInputError("The assistant already finished for the current case state. Change a fact to run it again.");
  const facts = buildDemoFacts(preparation.case, preparation.event, preparation.joiner, preparation.equipment);
  const base: DemoPreparation = {
    ...preparation,
    run_id: nextRunId(),
    model: modelMetadata(mode),
    facts,
    draft_unavailable: undefined,
    trace: [
      ...preparation.trace,
      { actor: "system", kind: "agent.retry", summary: `Ran the assistant again for the current ${facts.start_date} case state.` },
    ],
  };
  if (preparation.agent?.trigger === "manager_coordination") {
    return prepareManagerCoordination(base, mode, now);
  }
  if (preparation.agent?.trigger === "access_requested") {
    return requestDemoAccess(base, mode, now);
  }
  if (preparation.agent?.trigger === "equipment_changed") {
    return reassessDemoEquipment(base, mode, now, { force: true });
  }
  const agent = await runAgent(
    preparation.case,
    preparation.joiner,
    preparation.agent?.trigger ?? "contract.signed",
    now,
    mode === "live" ? "live" : "mock",
    { force: true },
  );
  return applyAgentRun(base, agent);
}

function retirePendingEquipmentDraft(preparation: DemoPreparation, now: string, reason: string): string | null {
  const draft = preparation.draft;
  if (!draft || draft.workstream !== "equipment" || draft.status !== "pending") return null;
  if (!supersedeDraft(draft.id, now, reason)) throw new Error(`Equipment draft could not be superseded: ${draft.id}`);
  markCaseDraftSuperseded(preparation.case, draft.id, now, reason);
  return draft.id;
}

export async function reassessDemoEquipment(
  preparation: DemoPreparation,
  mode = process.env.DEMO_MODE ?? "mock",
  now = DEMO_NOW,
  options?: { force?: boolean; detectedByMonitor?: boolean },
): Promise<DemoPreparation> {
  const source = await readEquipmentSource(preparation.joiner.id);
  if (!options?.force && sameEquipmentObservation(preparation.equipment_observation, source.observation)) return preparation;

  const supersedeReason = `Superseded because equipment source revision changed from ${preparation.equipment_observation.source_revision} to ${source.observation.source_revision}.`;
  const supersededDraftId = retirePendingEquipmentDraft(preparation, now, supersedeReason);
  const facts = buildDemoFacts(preparation.case, preparation.event, preparation.joiner, source.result);
  const base: DemoPreparation = {
    ...preparation,
    run_id: nextRunId(),
    equipment: source.result,
    equipment_observation: source.observation,
    facts,
    draft: null,
    beforeApproval: null,
    decision: undefined,
    afterApproval: undefined,
    draft_unavailable: undefined,
    trace: [
      ...preparation.trace,
      { actor: "system", kind: "equipment.source.changed", summary: `Equipment ${source.observation.order_id} changed to ETA ${source.observation.eta}, status ${source.observation.status}, revision ${source.observation.source_revision}.` },
      ...(options?.detectedByMonitor ? [{ actor: "agent" as const, kind: "equipment.monitor.detected", summary: `Athena detected supplier revision ${source.observation.source_revision} and started an equipment reassessment.` }] : []),
      ...(supersededDraftId ? [{ actor: "system" as const, kind: "draft.superseded", summary: `Draft ${supersededDraftId} is unavailable after the equipment update.` }] : []),
    ],
  };
  const toolDefinitions = AGENT_TOOL_DEFINITIONS.filter((tool) => ["get_case_state", "check_equipment", "propose_message", "finish"].includes(tool.name));
  const agent = await runAgent(preparation.case, preparation.joiner, "equipment_changed", now, mode === "live" ? "live" : "mock", {
    force: true,
    cache: false,
    toolDefinitions,
    systemPrompt: [
      "You are Athena's bounded equipment reassessment assistant.",
      "Read the case and current equipment order.",
      "If the ETA is after the current start date, propose one nudge to the equipment task owner asking for a loaner or earlier delivery.",
      "Otherwise finish with no equipment action needed. Never call buddy, access or manager tools. Never send the message.",
    ].join("\n"),
  });
  let updated = applyAgentRun(base, agent);

  let verified: Awaited<ReturnType<typeof readEquipmentSource>>;
  try {
    verified = await readEquipmentSource(preparation.joiner.id);
  } catch (error) {
    retirePendingEquipmentDraft(updated, now, "Superseded because the final supplier verification failed.");
    return {
      ...updated,
      run_id: nextRunId(),
      draft: null,
      beforeApproval: null,
      decision: undefined,
      afterApproval: undefined,
      draft_unavailable: { message: "The final supplier check failed. The unverified draft was discarded; current facts remain visible and you can run the equipment reassessment again." },
      trace: [...updated.trace, { actor: "system", kind: "equipment.reassessment.unverified", summary: error instanceof Error ? error.message : "The final supplier check failed." }],
    };
  }
  if (!sameEquipmentObservation(source.observation, verified.observation)) {
    retirePendingEquipmentDraft(updated, now, "Superseded because equipment changed while the replacement draft was being prepared.");
    updated = {
      ...updated,
      run_id: nextRunId(),
      equipment: verified.result,
      facts: buildDemoFacts(updated.case, updated.event, updated.joiner, verified.result),
      draft: null,
      beforeApproval: null,
      draft_unavailable: { message: "Equipment changed while Athena was preparing the draft. Current facts are shown; run the equipment reassessment again." },
      trace: [...updated.trace, { actor: "system", kind: "equipment.reassessment.stale", summary: "The supplier source changed during drafting, so no draft is available for approval." }],
    };
  }
  return updated;
}

export async function requestDemoAccess(
  preparation: DemoPreparation,
  mode = process.env.DEMO_MODE ?? "mock",
  now = DEMO_NOW,
): Promise<DemoPreparation> {
  const toolDefinitions = AGENT_TOOL_DEFINITIONS.filter((tool) => ["get_case_state", "request_access", "finish"].includes(tool.name));
  const agent = await runAgent(
    preparation.case,
    preparation.joiner,
    "access_requested",
    now,
    mode === "live" ? "live" : "mock",
    {
      force: true,
      toolDefinitions,
      systemPrompt: [
        "You are Athena's bounded access-request assistant.",
        "Read onboarding.access first. Call request_access only for role-matrix rows whose request_id is null.",
        "Summarise progress from the resulting receipt state, including receipts that existed before this run.",
        "A request is not a grant. Never claim access was granted and never call any unlisted tool.",
        "Finish with the number of requests awaiting their named approvers.",
      ].join("\n"),
    },
  );
  return applyAgentRun(preparation, agent);
}

const ACTIVE_MANAGER_PLAN_STATUSES = new Set<ManagerPlanRequest["status"]>([
  "pending_approval",
  "send_failed",
  "awaiting_response",
  "responded",
  "confirmed",
]);

function latestManagerPlan(c: Case): ManagerPlanRequest | null {
  return c.manager_plans?.at(-1) ?? null;
}

function managerPlanTask(c: Case) {
  return c.tasks.find((task) => task.type === "manager_day_one_plan");
}

function managerDraftFor(c: Case, request: ManagerPlanRequest | null): Draft | null {
  return request ? c.drafts.find((draft) => draft.id === request.draft_id) ?? null : null;
}

function attachManagerRequest(preparation: DemoPreparation, draft: Draft, now: string): DemoPreparation {
  const existing = preparation.case.manager_plans?.find((request) => request.draft_id === draft.id);
  if (existing) return preparation;
  const request: ManagerPlanRequest = {
    id: `MANAGER-PLAN-${randomUUID()}`,
    case_id: preparation.case.id,
    joiner_id: preparation.joiner.id,
    manager_id: draft.to,
    draft_id: draft.id,
    start_date: preparation.case.start_date,
    status: "pending_approval",
    created_at: now,
  };
  preparation.case.manager_plans ??= [];
  preparation.case.manager_plans.push(request);
  const task = managerPlanTask(preparation.case);
  if (task) {
    task.status = "waiting_approval";
    task.detail = `Manager request ${request.id} awaits People approval.`;
  }
  recordCaseStep(preparation.case, "agent", "manager.request.prepared", `Prepared manager plan request ${request.id} to ${personById(request.manager_id)?.full_name ?? request.manager_id}; draft ${request.draft_id} awaits People approval.`, now, { request_id: request.id, draft_id: request.draft_id });
  preparation.trace.push({ actor: "agent", kind: "manager.request.prepared", summary: `Prepared a first-day plan request to ${personById(request.manager_id)?.full_name ?? request.manager_id}.` });
  return preparation;
}

function invalidateManagerPlan(c: Case, request: ManagerPlanRequest, now: string, reason: string): void {
  if (request.status === "pending_approval") {
    supersedeDraft(request.draft_id, now, reason);
    updateCaseDraftFromTrustedState(c, request.draft_id, "rejected", undefined, now, reason);
  }
  request.status = "superseded";
  request.invalidated_at = now;
  request.invalidation_reason = reason;
  const task = managerPlanTask(c);
  if (task) {
    task.status = "open";
    task.detail = reason;
    delete task.done_at;
    delete task.done_by;
  }
  recordCaseStep(c, "system", "manager.plan.invalidated", `Manager plan ${request.id} was invalidated. ${reason}`, now, { request_id: request.id });
}

export async function prepareManagerCoordination(
  preparation: DemoPreparation,
  mode = process.env.DEMO_MODE ?? "mock",
  now = DEMO_NOW,
): Promise<DemoPreparation> {
  const existing = latestManagerPlan(preparation.case);
  if (existing && ACTIVE_MANAGER_PLAN_STATUSES.has(existing.status)) return preparation;
  const linkedDraftIds = new Set(preparation.case.manager_plans?.map((request) => request.draft_id) ?? []);
  const recoverableDraft = [...preparation.case.drafts].reverse().find((draft) =>
    draft.workstream === "manager" && draft.status === "pending" && !linkedDraftIds.has(draft.id));
  if (recoverableDraft) return attachManagerRequest(preparation, recoverableDraft, now);
  const toolDefinitions = AGENT_TOOL_DEFINITIONS.filter((tool) => ["get_case_state", "propose_message", "finish"].includes(tool.name));
  const agent = await runAgent(
    preparation.case,
    preparation.joiner,
    "manager_coordination",
    now,
    mode === "live" ? "live" : "mock",
    {
      force: true,
      toolDefinitions,
      systemPrompt: [
        "You are Athena's bounded manager-coordination assistant.",
        "Read the case, then propose one pending message to the owner of manager_day_one_plan.",
        "Ask for arrival time, meeting place, first-day outline and anything to bring for the current start date.",
        "Do not send or mark the plan complete. Finish with the exact human approval needed next.",
      ].join("\n"),
    },
  );
  const updated = applyAgentRun(preparation, agent);
  const proposal = agent.proposals.find((candidate) => candidate.draft.workstream === "manager");
  if (!proposal) return updated;
  return attachManagerRequest(updated, proposal.draft, now);
}

export async function editDemoManagerDraft(
  preparation: DemoPreparation,
  requestId: unknown,
  draftId: unknown,
  subject: unknown,
  body: unknown,
  editedBy = "pp-1",
  now = DEMO_NOW,
): Promise<DemoPreparation> {
  const request = latestManagerPlan(preparation.case);
  const currentDraft = managerDraftFor(preparation.case, request);
  if (!request || request.id !== requestId || request.status !== "pending_approval" || !currentDraft || currentDraft.id !== draftId || currentDraft.status !== "pending") {
    throw new BuddyFlowConflict("This manager draft is no longer current.");
  }
  if (personById(editedBy)?.function !== "people") throw new BuddyFlowConflict("Manager draft edits must use a named People actor.");
  const normalizedSubject = normalizedHumanDraftText(subject, "subject", MAX_DRAFT_SUBJECT_LENGTH);
  const normalizedBody = normalizedHumanDraftText(body, "body", MAX_DRAFT_BODY_LENGTH);
  if (normalizedSubject === currentDraft.subject && normalizedBody === currentDraft.body) return preparation;
  const replacement: Draft = {
    ...currentDraft,
    id: `DRAFT-${randomUUID()}`,
    subject: normalizedSubject,
    body: normalizedBody,
    status: "pending",
    created_at: now,
    revision: (currentDraft.revision ?? 0) + 1,
    edited_by: editedBy,
    edited_at: now,
    supersedes_draft_id: currentDraft.id,
    decided_at: undefined,
    decided_by: undefined,
    decision_reason: undefined,
  };
  if (!registerDraft(replacement)) throw new Error(`Manager draft could not be registered: ${replacement.id}`);
  const reason = "Superseded by a saved People edit.";
  if (!supersedeDraft(currentDraft.id, now, reason)) {
    discardDraft(replacement.id);
    throw new BuddyFlowConflict("This manager draft changed before the edit was saved.");
  }
  updateCaseDraftFromTrustedState(preparation.case, currentDraft.id, "rejected", undefined, now, reason);
  preparation.case.drafts.push(replacement);
  request.draft_id = replacement.id;
  const updated = { ...preparation, run_id: nextRunId() };
  recordCaseStep(updated.case, "human", "manager.draft.edited", `Sarah Mitchell saved manager draft ${replacement.id}; ${currentDraft.id} was superseded.`, now, { request_id: request.id, draft_id: replacement.id });
  updated.trace = [...preparation.trace, { actor: "human", kind: "manager.draft.edited", summary: `Saved a new exact manager draft for approval (${replacement.id}).` }];
  return updated;
}

export async function resolveManagerApproval(
  preparation: DemoPreparation,
  requestId: unknown,
  draftId: unknown,
  decision: DemoDecision,
  decidedBy = "pp-1",
  now = DEMO_NOW,
): Promise<DemoPreparation> {
  const request = latestManagerPlan(preparation.case);
  const draft = managerDraftFor(preparation.case, request);
  const retryingApprovedSend = request?.status === "send_failed" && draft?.status === "approved" && decision === "approve";
  const decidingPendingDraft = request?.status === "pending_approval" && draft?.status === "pending";
  if (!request || request.id !== requestId || !draft || draft.id !== draftId || (!decidingPendingDraft && !retryingApprovedSend)) {
    throw new BuddyFlowConflict("This manager approval is no longer current.");
  }
  if (decision === "reject") {
    if (!rejectDraft(draft.id, decidedBy, now, "Rejected by People.")) throw new BuddyFlowConflict("This manager approval could not be recorded.");
    updateCaseDraftFromTrustedState(preparation.case, draft.id, "rejected", decidedBy, now, "Rejected by People.");
    request.status = "rejected";
    const task = managerPlanTask(preparation.case);
    if (task) task.status = "open";
    recordCaseStep(preparation.case, "human", "manager.draft.rejected", `Manager draft ${draft.id} rejected by ${decidedBy}; nothing was sent.`, now);
    return { ...preparation, run_id: nextRunId(), trace: [...preparation.trace, { actor: "human", kind: "manager.draft.rejected", summary: "Manager request rejected. Nothing was sent." }] };
  }
  if (!retryingApprovedSend) {
    if (!approveDraft(draft.id, decidedBy, now)) throw new BuddyFlowConflict("This manager approval could not be recorded.");
    updateCaseDraftFromTrustedState(preparation.case, draft.id, "approved", decidedBy, now);
    recordCaseStep(preparation.case, "human", "manager.draft.approved", `Manager draft ${draft.id} approved by ${decidedBy}.`, now);
  }
  const send = requireAction("slack.send_message");
  let sentResult: ToolResult;
  try {
    sentResult = await send.action.run({ draft_id: draft.id, now });
  } catch (error) {
    sentResult = { status: "error", summary: error instanceof Error ? error.message : "Manager request delivery failed.", retryable: true };
  }
  if (sentResult.status !== "ok") {
    request.status = "send_failed";
    request.send_failed_at = now;
    request.send_error = sentResult.summary;
    const task = managerPlanTask(preparation.case);
    if (task) task.detail = `Manager request ${request.id} was approved, but delivery failed. Retry the same approved draft.`;
    recordCaseStep(preparation.case, "system", "manager.request.send_failed", `Approved manager draft ${draft.id} was not delivered: ${sentResult.summary}`, now, { request_id: request.id, draft_id: draft.id });
    return {
      ...preparation,
      run_id: nextRunId(),
      trace: [...preparation.trace, ...(!retryingApprovedSend ? [{ actor: "human" as const, kind: "manager.draft.approved", summary: `Approved the exact request to ${personById(request.manager_id)?.full_name ?? request.manager_id}.` }] : []), { actor: "system", kind: "manager.request.send_failed", summary: `Delivery failed for the approved request: ${sentResult.summary}` }],
    };
  }
  request.status = "awaiting_response";
  request.sent_at = now;
  delete request.send_failed_at;
  delete request.send_error;
  const task = managerPlanTask(preparation.case);
  if (task) task.detail = `Approved manager request ${request.id} was sent; awaiting ${personById(request.manager_id)?.full_name ?? request.manager_id}.`;
  recordCaseStep(preparation.case, "agent", "manager.request.sent", sentResult.summary, now, { request_id: request.id, draft_id: draft.id });
  return { ...preparation, run_id: nextRunId(), trace: [...preparation.trace, ...(!retryingApprovedSend ? [{ actor: "human" as const, kind: "manager.draft.approved", summary: `Approved the exact request to ${personById(request.manager_id)?.full_name ?? request.manager_id}.` }] : []), { actor: "agent", kind: "manager.request.sent", summary: sentResult.summary }] };
}

export interface ManagerPlanResponseInput {
  arrival_time: string;
  meeting_place: string;
  first_day_outline: string[];
  items_to_bring: string[];
}

export function recordManagerResponse(
  preparation: DemoPreparation,
  requestId: unknown,
  response: ManagerPlanResponseInput,
  now = DEMO_NOW,
): DemoPreparation {
  const request = latestManagerPlan(preparation.case);
  if (!request || request.id !== requestId || request.status !== "awaiting_response") throw new BuddyFlowConflict("This manager request is not awaiting a response.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(response.arrival_time)
    || !response.meeting_place.trim()
    || response.first_day_outline.length === 0
    || response.first_day_outline.some((item) => !item.trim())
    || response.items_to_bring.length === 0
    || response.items_to_bring.some((item) => !item.trim())) {
    throw new DemoInputError("The simulated manager response must include arrival time, meeting place, first-day outline and items to bring.");
  }
  Object.assign(request, {
    status: "responded" as const,
    response_at: now,
    arrival_time: response.arrival_time,
    meeting_place: response.meeting_place.trim(),
    first_day_outline: response.first_day_outline.map((item) => item.trim()),
    items_to_bring: response.items_to_bring.map((item) => item.trim()),
  });
  recordCaseStep(preparation.case, "human", "manager.response.simulated", `${personById(request.manager_id)?.full_name ?? request.manager_id} supplied a simulated first-day plan for People review.`, now, { request_id: request.id });
  return { ...preparation, run_id: nextRunId(), trace: [...preparation.trace, { actor: "human", kind: "manager.response.simulated", summary: `Simulated response received from ${personById(request.manager_id)?.full_name ?? request.manager_id}; People confirmation is still required.` }] };
}

export function confirmManagerPlan(
  preparation: DemoPreparation,
  requestId: unknown,
  confirmedBy = "pp-1",
  now = DEMO_NOW,
): DemoPreparation {
  const request = latestManagerPlan(preparation.case);
  if (!request || request.id !== requestId || request.status !== "responded" || request.start_date !== preparation.case.start_date) {
    throw new BuddyFlowConflict("This manager plan is not ready for confirmation.");
  }
  request.status = "confirmed";
  request.confirmed_at = now;
  request.confirmed_by = confirmedBy;
  const task = managerPlanTask(preparation.case);
  if (!task) throw new Error("Manager day-one plan task is missing.");
  task.status = "done";
  task.done_at = now;
  task.done_by = confirmedBy;
  task.detail = `First-day plan ${request.id} confirmed by ${personById(confirmedBy)?.full_name ?? confirmedBy}.`;
  preparation.case.state = deriveState(preparation.case);
  recordCaseStep(preparation.case, "human", "manager.plan.confirmed", `First-day plan ${request.id} confirmed by ${personById(confirmedBy)?.full_name ?? confirmedBy}.`, now, { request_id: request.id });
  return { ...preparation, run_id: nextRunId(), trace: [...preparation.trace, { actor: "human", kind: "manager.plan.confirmed", summary: "People confirmed the manager's first-day plan." }] };
}

function normalizedHumanDraftText(value: unknown, field: "subject" | "body", maxLength: number): string {
  if (typeof value !== "string") throw new BuddyFlowConflict(`Draft ${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new BuddyFlowConflict(`Draft ${field} cannot be empty.`);
  if (normalized.length > maxLength) throw new BuddyFlowConflict(`Draft ${field} must be ${maxLength} characters or fewer.`);
  return normalized;
}

export async function editDemoEquipmentDraft(
  preparation: DemoPreparation,
  draftId: unknown,
  subject: unknown,
  body: unknown,
  editedBy = "pp-1",
  now = DEMO_NOW,
): Promise<DemoPreparation> {
  const normalizedSubject = normalizedHumanDraftText(subject, "subject", MAX_DRAFT_SUBJECT_LENGTH);
  const normalizedBody = normalizedHumanDraftText(body, "body", MAX_DRAFT_BODY_LENGTH);
  if (personById(editedBy)?.function !== "people") throw new BuddyFlowConflict("Equipment draft edits must use a named People actor.");
  const currentDraft = preparation.draft;
  if (typeof draftId !== "string" || !draftId) throw new BuddyFlowConflict("draft_id is required for an equipment draft edit.");
  if (!currentDraft || currentDraft.id !== draftId) throw new BuddyFlowConflict("This equipment draft is no longer the current reviewed action.");
  if (preparation.decision || currentDraft.kind !== "nudge" || currentDraft.action !== "slack.send_message" || currentDraft.status !== "pending") {
    throw new BuddyFlowConflict("Only the current pending equipment draft can be edited.");
  }

  const caseDraft = preparation.case.drafts.find((draft) => draft.id === draftId);
  if (!caseDraft || caseDraft.kind !== "nudge" || caseDraft.action !== "slack.send_message" || caseDraft.status !== "pending") {
    throw new BuddyFlowConflict("Only the current pending equipment draft can be edited.");
  }

  if (normalizedSubject === (currentDraft.subject ?? "").trim() && normalizedBody === currentDraft.body.trim()) {
    return preparation;
  }

  const supersedeReason = "Superseded by a People edit before approval.";
  const nextDraft: Draft = {
    ...currentDraft,
    id: `DRAFT-${randomUUID()}`,
    subject: normalizedSubject,
    body: normalizedBody,
    status: "pending",
    created_at: now,
    decided_at: undefined,
    decided_by: undefined,
    decision_reason: undefined,
    revision: (currentDraft.revision ?? 0) + 1,
    edited_by: editedBy,
    edited_at: now,
    supersedes_draft_id: currentDraft.id,
    citations: currentDraft.citations ? [...currentDraft.citations] : undefined,
  };
  if (!registerDraft(nextDraft)) throw new Error(`Demo draft was not registered: ${nextDraft.id}`);
  if (!supersedeDraft(currentDraft.id, now, supersedeReason)) throw new Error(`Demo draft could not be superseded: ${currentDraft.id}`);
  markCaseDraftSuperseded(preparation.case, currentDraft.id, now, supersedeReason);
  preparation.case.drafts.push({ ...nextDraft, citations: nextDraft.citations ? [...nextDraft.citations] : undefined });

  const editSummary = `People edited draft ${currentDraft.id} into ${nextDraft.id}.`;
  recordCaseStep(preparation.case, "human", "draft.edited", editSummary, now, {
    old_draft_id: currentDraft.id,
    new_draft_id: nextDraft.id,
    edited_by: editedBy,
  });
  const slackAction = requireAction("slack.send_message");
  const beforeApproval = await slackAction.action.run({ draft_id: nextDraft.id, now });
  recordCaseStep(preparation.case, "system", "send.refused", beforeApproval.summary, now, { draft_id: nextDraft.id });

  return {
    ...preparation,
    run_id: nextRunId(),
    draft: nextDraft,
    beforeApproval,
    decision: undefined,
    afterApproval: undefined,
    draft_unavailable: undefined,
    trace: [
      ...preparation.trace,
      { actor: "human", kind: "draft.edited", summary: editSummary },
      { actor: "system", kind: "draft.superseded", summary: `Draft ${currentDraft.id} is unavailable after the People edit.` },
      { actor: "system", kind: "draft.created", summary: `Draft ${nextDraft.id} created from the saved People wording and awaits approval.` },
      { actor: "system", kind: "send.refused", summary: `Equipment nudge draft ${nextDraft.id}: ${beforeApproval.summary}` },
    ],
  };
}

export async function resolveDemoApproval(
  preparation: DemoPreparation,
  decision: DemoDecision,
  decidedBy = "pp-1",
  now = DEMO_NOW,
): Promise<DemoResolution> {
  if (!preparation.draft || !preparation.beforeApproval) throw new Error("Demo has no current draft requiring approval");
  const currentSource = await readEquipmentSource(preparation.joiner.id);
  const draftMatchesSource = preparation.draft.equipment_observation_signature === currentSource.observation.signature
    && preparation.draft.equipment_source_revision === currentSource.observation.source_revision;
  if (!draftMatchesSource) {
    const oldRevision = preparation.draft.equipment_source_revision ?? "unbound";
    retirePendingEquipmentDraft(preparation, now, `Superseded before approval because equipment source revision changed from ${oldRevision} to ${currentSource.observation.source_revision}.`);
    const recoveryAgent = preparation.agent
      ? { ...preparation.agent, trigger: "equipment_changed" as const, stop_reason: "guard" as const, next_action: "Run assistant again." }
      : undefined;
    const recovery: DemoPreparation = {
      ...preparation,
      run_id: nextRunId(),
      agent: recoveryAgent,
      equipment: currentSource.result,
      facts: buildDemoFacts(preparation.case, preparation.event, preparation.joiner, currentSource.result),
      draft: null,
      beforeApproval: null,
      decision: undefined,
      afterApproval: undefined,
      draft_unavailable: { message: "The equipment source changed after this draft was prepared. The stale draft was not approved or sent. Run the equipment reassessment again." },
      trace: [...preparation.trace, { actor: "system", kind: "approval.refused.stale_equipment", summary: `Draft approval refused because equipment ${currentSource.observation.order_id} is now revision ${currentSource.observation.source_revision}.` }],
    };
    throw new EquipmentApprovalConflict("This equipment draft is stale because the supplier information changed.", recovery);
  }
  const changed = decision === "approve"
    ? approveDraft(preparation.draft.id, decidedBy, now)
    : rejectDraft(preparation.draft.id, decidedBy, now, "Rejected in the approval screen.");
  if (!changed) throw new Error(`Demo approval could not be recorded for ${preparation.draft.id}`);

  const draft = updateCaseDraft(preparation.case, preparation.draft.id, decision, decidedBy, now);
  const trace = [...preparation.trace];
  trace.push({
    actor: "human",
    kind: decision === "approve" ? "draft.approved" : "draft.rejected",
    summary: decision === "approve"
      ? `Draft ${draft.id} approved by ${decidedBy}.`
      : `Draft ${draft.id} rejected by ${decidedBy}.`,
  });

  const slackAction = requireAction("slack.send_message");
  const afterApproval = await slackAction.action.run({ draft_id: draft.id, now });
  trace.push({
    actor: "system",
    kind: decision === "approve" ? "send.completed" : "send.refused",
    summary: afterApproval.summary,
  });

  return {
    run_id: nextRunId(),
    decision,
    case: preparation.case,
    joiner: preparation.joiner,
    model: preparation.model,
    draft,
    equipment: preparation.equipment,
    equipment_observation: preparation.equipment_observation,
    beforeApproval: preparation.beforeApproval,
    afterApproval,
    facts: preparation.facts,
    buddy: preparation.buddy,
    date_change: preparation.date_change,
    draft_unavailable: preparation.draft_unavailable,
    trace,
  };
}

function formatBuddySlot(slot: BuddyRequest["slots"][number]): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: slot.timezone,
  }).format(new Date(slot.start_at)).replace(",", "");
  const time = (value: string) => new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: slot.timezone,
  }).format(new Date(value));
  return `${date}, ${time(slot.start_at)} to ${time(slot.end_at)} (${slot.timezone})`;
}

function buddyRequestBody(joiner: Joiner, candidateName: string, slots: BuddyRequest["slots"]): string {
  const slotSummary = slots
    .map((slot) => `${slot.kind[0].toUpperCase()}${slot.kind.slice(1)} ${formatBuddySlot(slot)}`)
    .join("; ");
  return `Hi ${candidateName}, could you support ${joiner.preferred_name} as their onboarding buddy? The proposed commitment is one introduction and one shadowing session during the first working week: ${slotSummary}. Please accept or decline this specific request.`;
}

export async function prepareBuddyRequest(
  preparation: DemoPreparation,
  candidateId?: string,
  now = DEMO_NOW,
): Promise<DemoPreparation> {
  const existing = latestBuddyRequest(preparation.case);
  if (existing && ACTIVE_BUDDY_REQUEST_STATUSES.has(existing.status)) {
    if (!candidateId || candidateId === existing.candidate_id) return preparation;
    throw new BuddyFlowConflict(`Buddy request ${existing.id} is already ${existing.status}. Await its next decision before preparing another request.`);
  }

  const availability = await readBuddyAvailability(preparation.joiner, preparation.case.start_date, declinedBuddyIds(preparation.case), preparation.case.id);
  const selectedId = candidateId ?? availability.recommendation?.candidate_id;
  const selected = selectedId
    ? availability.candidates.find((assessment) => assessment.candidate.id === selectedId)
    : undefined;
  if (!selected || !selected.eligibility.eligible || selected.availability.status !== "available") {
    throw new BuddyFlowConflict(
      selectedId
        ? `${buddyName(selectedId)} is not a current eligible and available candidate. Prepare a new request from the current assessment.`
        : availability.escalation?.summary ?? "No current eligible buddy has the required first-week slots.",
    );
  }

  const requestId = `BUDDY-REQ-${randomUUID()}`;
  const draftId = `DRAFT-BUDDY-${randomUUID()}`;
  const draft: Draft = {
    id: draftId,
    case_id: preparation.case.id,
    kind: "buddy_intro",
    action: "slack.send_message",
    channel: "slack",
    to: selected.candidate.id,
    subject: `Buddy support request for ${preparation.joiner.preferred_name}`,
    body: buddyRequestBody(preparation.joiner, selected.candidate.full_name, selected.availability.slots),
    status: "pending",
    created_at: now,
  };
  if (!registerDraft(draft)) throw new Error(`Buddy draft was not registered: ${draft.id}`);

  const request: BuddyRequest = {
    id: requestId,
    case_id: preparation.case.id,
    draft_id: draftId,
    candidate_id: selected.candidate.id,
    start_date: preparation.case.start_date,
    slots: selected.availability.slots.map((slot) => ({ ...slot })),
    status: "pending_approval",
    created_at: now,
  };
  preparation.case.drafts.push({ ...draft, citations: draft.citations ? [...draft.citations] : undefined });
  preparation.case.buddy_requests.push(request);
  updateBuddyTask(preparation.case, "waiting_approval", `Buddy request ${request.id} awaits People approval for ${selected.candidate.full_name}.`);
  recordCaseStep(preparation.case, "agent", "buddy.request.prepared", `Prepared a buddy request for ${selected.candidate.full_name} with two proposed first-week slots.`, now, {
    request_id: request.id,
    draft_id: draft.id,
    candidate_id: request.candidate_id,
    start_date: request.start_date,
    slots: request.slots,
  });
  recordCaseStep(preparation.case, "agent", "draft.created", `Draft ${draft.id} created for the buddy request and awaits People approval.`, now, {
    draft_id: draft.id,
    request_id: request.id,
  });

  const slackAction = requireAction("slack.send_message");
  const beforeApproval = await slackAction.action.run({ draft_id: draft.id, now });
  recordCaseStep(preparation.case, "system", "send.refused", beforeApproval.summary, now, { draft_id: draft.id, request_id: request.id });

  return {
    ...preparation,
    run_id: nextRunId(),
    buddy: buddyState(availability, request, draft, beforeApproval),
    trace: [
      ...preparation.trace,
      { actor: "agent", kind: "buddy.request.prepared", summary: `Prepared a buddy request for ${selected.candidate.full_name} with two proposed first-week slots.` },
      { actor: "agent", kind: "draft.created", summary: `Draft ${draft.id} created for the buddy request and awaits People approval.` },
      { actor: "system", kind: "send.refused", summary: `Buddy request draft ${draft.id}: ${beforeApproval.summary}` },
    ],
  };
}

async function invalidateBuddyForAvailabilityChange(
  preparation: DemoPreparation,
  request: BuddyRequest,
  availability: BuddyAvailabilityResult,
  now: string,
  reason: string,
): Promise<DemoBuddyActionResult> {
  invalidateBuddyRequest(preparation.case, request, now, reason);
  // Re-read after invalidation: a released reservation changes the capacity counts shown.
  const refreshed = request.status === "superseded" && availability.candidates.length > 0
    ? await readBuddyAvailability(preparation.joiner, preparation.case.start_date, declinedBuddyIds(preparation.case), preparation.case.id)
    : availability;
  const updated: DemoPreparation = {
    ...preparation,
    run_id: nextRunId(),
    buddy: buddyState(refreshed, request),
    trace: [
      ...preparation.trace,
      { actor: "system", kind: "buddy.request.invalidated", summary: `Buddy request ${request.id} was invalidated because the current availability no longer matches the reviewed proposal.` },
      { actor: "agent", kind: "tool.buddy_directory.get_availability", summary: refreshed.recommendation ? `Recommended ${refreshed.recommendation.candidate_name} from the refreshed availability.` : refreshed.escalation?.summary ?? "No buddy recommendation is available from the refreshed availability." },
    ],
  };
  return { preparation: updated, conflict: `${reason} The old request cannot be approved or confirmed; prepare a new request from the refreshed facts.` };
}

export async function simulateBuddyAvailabilityChange(
  preparation: DemoPreparation,
  candidateId: string,
  now = DEMO_NOW,
  mode = process.env.DEMO_MODE ?? "mock",
): Promise<DemoPreparation> {
  const snapshot = buddyCalendarById(candidateId);
  if (!snapshot) throw new BuddyFlowConflict(`No simulated calendar is available for ${buddyName(candidateId)}.`);

  setSimulatedBuddyCalendar({ ...snapshot, read_status: "unknown" });
  const request = latestBuddyRequest(preparation.case);
  const affectsCurrentRequest = !!request
    && ACTIVE_BUDDY_REQUEST_STATUSES.has(request.status)
    && request.candidate_id === candidateId;
  if (affectsCurrentRequest && request) {
    invalidateBuddyRequest(preparation.case, request, now, "Simulated calendar availability changed for the proposed buddy.");
    preparation.case.state = deriveState(preparation.case);
  }

  const availability = await readBuddyAvailability(
    preparation.joiner,
    preparation.case.start_date,
    declinedBuddyIds(preparation.case),
    preparation.case.id,
  );
  const requestSummary = affectsCurrentRequest && request
    ? `Request ${request.id} was invalidated because its simulated calendar changed.`
    : undefined;

  const updated: DemoPreparation = {
    ...preparation,
    run_id: nextRunId(),
    buddy: buddyState(
      availability,
      preparation.case.buddy_requests.at(-1) ?? preparation.buddy.request,
      affectsCurrentRequest ? null : preparation.buddy.draft,
      affectsCurrentRequest ? null : preparation.buddy.beforeApproval,
      affectsCurrentRequest ? undefined : preparation.buddy.afterApproval,
    ),
    trace: [
      ...preparation.trace,
      { actor: "human", kind: "simulation.buddy_calendar.changed", summary: `Simulated ${buddyName(candidateId)} calendar availability changed to unknown.` },
      ...(requestSummary ? [{ actor: "system" as const, kind: "buddy.request.invalidated", summary: requestSummary }] : []),
    ],
  };
  const agent = await runAgent(updated.case, updated.joiner, "availability_changed", now, mode === "live" ? "live" : "mock");
  return applyAgentRun(updated, agent);
}

export async function resolveBuddyApproval(
  preparation: DemoPreparation,
  requestId: string,
  draftId: string,
  decision: BuddyApprovalDecision,
  decidedBy = "pp-1",
  now = DEMO_NOW,
): Promise<DemoBuddyActionResult> {
  const request = preparation.case.buddy_requests.find((candidate) => candidate.id === requestId);
  if (!request || preparation.buddy.request?.id !== requestId || preparation.buddy.draft?.id !== draftId) {
    throw new BuddyFlowConflict("This buddy request or draft is no longer the current reviewed action.");
  }
  if (request.status !== "pending_approval") {
    throw new BuddyFlowConflict(`Buddy request ${request.id} is ${request.status} and cannot receive another approval decision.`);
  }
  if (personById(decidedBy)?.function !== "people") {
    throw new BuddyFlowConflict("Buddy requests must be approved or rejected by a named People actor.");
  }
  if (preparation.buddy.draft.status !== "pending") {
    throw new BuddyFlowConflict(`Buddy draft ${draftId} is ${preparation.buddy.draft.status} and cannot receive another approval decision.`);
  }

  const availability = await readBuddyAvailability(preparation.joiner, preparation.case.start_date, declinedBuddyIds(preparation.case), preparation.case.id);
  if (!availabilityMatchesRequest(availability, request)) {
    return invalidateBuddyForAvailabilityChange(
      preparation,
      request,
      availability,
      now,
      "Buddy availability changed after the request was prepared.",
    );
  }

  const changed = decision === "approve"
    ? approveDraft(draftId, decidedBy, now)
    : rejectDraft(draftId, decidedBy, now, "Rejected in the approval screen.");
  if (!changed) throw new BuddyFlowConflict(`Buddy approval could not be recorded for ${draftId}.`);

  const draft = updateCaseDraftFromTrustedState(
    preparation.case,
    draftId,
    decision === "approve" ? "approved" : "rejected",
    decidedBy,
    now,
    decision === "reject" ? "Rejected in the approval screen." : undefined,
  );
  const trace = [...preparation.trace, {
    actor: "human" as const,
    kind: decision === "approve" ? "buddy.request.approved" : "buddy.request.rejected",
    summary: decision === "approve"
      ? `Buddy request ${request.id} and exact draft ${draft.id} approved by ${decidedBy}.`
      : `Buddy request ${request.id} rejected by ${decidedBy}. No message was sent.`,
  }];

  const slackAction = requireAction("slack.send_message");
  const afterApproval = await slackAction.action.run({ draft_id: draft.id, now });
  if (decision === "approve") {
    request.status = "awaiting_acceptance";
    request.sent_at = now;
    updateBuddyTask(preparation.case, "open", `Awaiting ${buddyName(request.candidate_id)} response to request ${request.id}.`);
  } else {
    request.status = "rejected";
    updateBuddyTask(preparation.case, "open", `People rejected buddy request ${request.id}; no request was sent.`);
  }
  recordCaseStep(preparation.case, "human", decision === "approve" ? "buddy.request.approved" : "buddy.request.rejected", trace.at(-1)!.summary, now, {
    request_id: request.id,
    draft_id: draft.id,
    decided_by: decidedBy,
  });
  recordCaseStep(preparation.case, "system", decision === "approve" ? "buddy.request.sent" : "send.refused", afterApproval.summary, now, {
    request_id: request.id,
    draft_id: draft.id,
  });
  trace.push({ actor: "system", kind: decision === "approve" ? "buddy.request.sent" : "send.refused", summary: afterApproval.summary });

  return {
    preparation: {
      ...preparation,
      run_id: nextRunId(),
      buddy: buddyState(availability, request, draft, preparation.buddy.beforeApproval, afterApproval),
      trace,
    },
  };
}

export async function recordBuddyResponse(
  preparation: DemoPreparation,
  requestId: string,
  response: BuddyResponseDecision,
  now = DEMO_NOW,
  mode = process.env.DEMO_MODE ?? "mock",
): Promise<DemoBuddyActionResult> {
  const request = preparation.case.buddy_requests.find((candidate) => candidate.id === requestId);
  if (!request || preparation.buddy.request?.id !== requestId) {
    throw new BuddyFlowConflict("This buddy response does not match the current request.");
  }
  if (request.status !== "awaiting_acceptance" || request.sent_at === undefined || preparation.buddy.afterApproval?.status !== "ok") {
    throw new BuddyFlowConflict("Buddy responses are accepted only for the current successfully sent request.");
  }

  request.status = response === "accepted" ? "accepted" : "declined";
  request.response = response;
  request.responded_at = now;
  const summary = response === "accepted"
    ? `${buddyName(request.candidate_id)} accepted request ${request.id}; People confirmation is still required.`
    : `${buddyName(request.candidate_id)} declined request ${request.id}; the assistant will re-evaluate the current candidates.`;
  updateBuddyTask(preparation.case, "open", response === "accepted" ? `Awaiting People confirmation of ${buddyName(request.candidate_id)}.` : `Buddy request ${request.id} declined; People must choose another candidate.`);
  recordCaseStep(preparation.case, "system", "buddy.response.simulated", summary, now, {
    request_id: request.id,
    candidate_id: request.candidate_id,
    response,
  });
  const availability = await readBuddyAvailability(preparation.joiner, preparation.case.start_date, declinedBuddyIds(preparation.case), preparation.case.id);
  const updated: DemoPreparation = {
      ...preparation,
      run_id: nextRunId(),
      buddy: buddyState(availability, request, preparation.buddy.draft, preparation.buddy.beforeApproval, preparation.buddy.afterApproval),
      trace: [
        ...preparation.trace,
        { actor: "system", kind: "buddy.response.simulated", summary },
        { actor: "agent", kind: "tool.buddy_directory.get_availability", summary: availability.recommendation ? `Recommended ${availability.recommendation.candidate_name} as the next candidate.` : availability.escalation?.summary ?? "No replacement buddy recommendation is available." },
      ],
  };
  if (response === "declined") {
    const agent = await runAgent(updated.case, updated.joiner, "buddy_declined", now, mode === "live" ? "live" : "mock");
    return { preparation: applyAgentRun(updated, agent) };
  }
  return { preparation: updated };
}

export async function confirmBuddy(
  preparation: DemoPreparation,
  requestId: string,
  confirmedBy = "pp-1",
  now = DEMO_NOW,
): Promise<DemoBuddyActionResult> {
  const request = preparation.case.buddy_requests.find((candidate) => candidate.id === requestId);
  if (!request || preparation.buddy.request?.id !== requestId) {
    throw new BuddyFlowConflict("This People confirmation does not match the current request.");
  }
  if (personById(confirmedBy)?.function !== "people") {
    throw new BuddyFlowConflict("Buddy allocation must be confirmed by a named People actor.");
  }

  if (request.status !== "accepted" && !(request.status === "confirmed" && preparation.case.buddy_id === request.candidate_id)) {
    throw new BuddyFlowConflict(`Buddy request ${request.id} is ${request.status}; buddy acceptance must precede People confirmation.`);
  }

  const availability = await readBuddyAvailability(preparation.joiner, preparation.case.start_date, declinedBuddyIds(preparation.case), preparation.case.id);
  if (!availabilityMatchesRequest(availability, request)) {
    return invalidateBuddyForAvailabilityChange(
      preparation,
      request,
      availability,
      now,
      "Buddy availability changed before People confirmation.",
    );
  }

  if (request.status === "confirmed" && preparation.case.buddy_id === request.candidate_id) {
    const refreshed: DemoPreparation = {
      ...preparation,
      run_id: nextRunId(),
      buddy: buddyState(availability, request, preparation.buddy.draft, preparation.buddy.beforeApproval, preparation.buddy.afterApproval),
      trace: [
        ...preparation.trace,
        { actor: "agent", kind: "tool.buddy_directory.get_availability", summary: `Revalidated ${buddyName(request.candidate_id)} before suppressing a duplicate confirmation.` },
      ],
    };
    return { preparation: refreshed, duplicate: true };
  }

  const previousBuddyId = preparation.case.buddy_id;
  request.status = "confirmed";
  request.confirmed_at = now;
  request.confirmed_by = confirmedBy;
  if (previousBuddyId && previousBuddyId !== request.candidate_id) {
    releaseBuddyCapacity(preparation.case.id, previousBuddyId);
  }
  reserveBuddyCapacity(preparation.case.id, request.candidate_id);
  preparation.case.buddy_id = request.candidate_id;
  const refreshedAvailability = await readBuddyAvailability(preparation.joiner, preparation.case.start_date, declinedBuddyIds(preparation.case), preparation.case.id);
  updateBuddyTask(preparation.case, "done", `Buddy allocation confirmed for ${buddyName(request.candidate_id)}.`, confirmedBy, now);
  recordCaseStep(preparation.case, "human", "buddy.allocation.confirmed", `${buddyName(request.candidate_id)} confirmed for ${preparation.joiner.preferred_name} by ${confirmedBy}.`, now, {
    request_id: request.id,
    candidate_id: request.candidate_id,
    confirmed_by: confirmedBy,
  });
  preparation.case.state = deriveState(preparation.case);
  return {
    preparation: {
      ...preparation,
      run_id: nextRunId(),
      buddy: buddyState(refreshedAvailability, request, preparation.buddy.draft, preparation.buddy.beforeApproval, preparation.buddy.afterApproval),
      trace: [...preparation.trace, { actor: "human", kind: "buddy.allocation.confirmed", summary: `${buddyName(request.candidate_id)} confirmed by ${confirmedBy}.` }],
    },
  };
}

export async function runDemo(now = DEMO_NOW): Promise<DemoRun> {
  resetDemoState();
  const preparation = await prepareDemo(now);
  const resolution = await resolveDemoApproval(preparation, "approve", "pp-1", now);
  const slackAction = requireAction("slack.send_message");
  const retry = await slackAction.action.run({ draft_id: resolution.draft.id, now });
  const trace = [...resolution.trace, { actor: "system" as const, kind: "send.retried", summary: retry.summary }];
  return { ...preparation, ...resolution, approved: true, retry, trace };
}
