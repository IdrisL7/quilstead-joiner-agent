import { randomUUID } from "node:crypto";
import { buddyById } from "@/data/buddies";
import { buddyCalendarById } from "@/data/buddy-calendars";
import { EVENTS } from "@/data/events";
import { joinerById } from "@/data/joiners";
import { personById } from "@/data/people";
import { authorize } from "@/lib/permissions";
import { findAction } from "@/lib/connectors/registry";
import { loadKb } from "@/lib/connectors/simulated/policy-kb";
import {
  releaseBuddyCapacity,
  reserveBuddyCapacity,
  setSimulatedBuddyCalendar,
} from "@/lib/connectors/simulated/buddy-directory";
import {
  approveDraft,
  rejectDraft,
  registerDraft,
  supersedeDraft,
} from "@/lib/connectors/simulated/messaging";
import { draftEquipmentNudge, type NudgeModelDraft } from "@/lib/model";
import { CaseStore } from "@/lib/store/case-store";
import { currentJoinerById } from "@/lib/store/joiner-store";
import { resetDemoState } from "@/lib/store/demo-state";
import { deriveState } from "@/lib/state-machine";
import type { BuddyAvailabilityResult } from "@/lib/policy/buddy-availability";
import type { BuddyRequest, Case, Draft, HrisEvent, Joiner, ToolResult } from "@/lib/types";
import { runAgent } from "@/lib/agent/loop";
import type { AgentRun } from "@/lib/agent/types";

const DEMO_NOW = "2026-09-30T09:00:00Z";
const DEMO_EVENT_ID = "EVT-004";
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
  draft: Draft | null;
  equipment: ToolResult;
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

interface DraftState {
  model: Pick<NudgeModelDraft, "provider" | "model">;
  draft: Draft | null;
  beforeApproval: ToolResult | null;
  unavailable?: DemoDraftUnavailable;
  trace: DemoTraceEntry[];
}

const DRAFT_UNAVAILABLE_MESSAGE = "Draft unavailable. The case and dates are current, no message was sent, and you can retry drafting or change the start date.";
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

function requireAction(tool: string) {
  const resolved = findAction(tool);
  if (!resolved) throw new Error(`Demo action is not registered: ${tool}`);
  return resolved;
}

function nextRunId(): string {
  return `DEMO-RUN-${randomUUID()}`;
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
  draft.decided_at = decidedAt;
  draft.decision_reason = reason;
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

async function createDraftForCurrentState(
  c: Case,
  joiner: Joiner,
  equipment: ToolResult,
  facts: DemoFacts,
  now: string,
  mode: string,
  draftId = `DRAFT-${randomUUID()}`,
): Promise<DraftState> {
  const model = modelMetadata(mode);
  if (!facts.equipment_late) {
    return {
      model,
      draft: null,
      beforeApproval: null,
      trace: [{ actor: "system", kind: "risk.cleared", summary: `Equipment ETA ${facts.equipment_eta} is before the ${facts.start_date} start. No nudge is required.` }],
    };
  }

  const equipmentTask = c.tasks.find((task) => task.type === "equipment_order");
  if (!equipmentTask) throw new Error("Demo equipment task is missing from the plan");
  const modelDraft = await draftEquipmentNudge({
    joiner: {
      full_name: joiner.full_name,
      preferred_name: joiner.preferred_name,
      title: joiner.title,
      start_date: joiner.start_date,
      office: joiner.office,
      work_mode: joiner.work_mode,
      equipment_preference: joiner.equipment_preference,
    },
    equipment: {
      status: equipment.status,
      summary: equipment.summary,
      data: equipmentData(equipment),
    },
    equipmentTask,
    ownerName: facts.equipment_owner_name,
  }, mode);

  const draft: Draft = {
    id: draftId,
    case_id: c.id,
    kind: "nudge",
    action: "slack.send_message",
    channel: "slack",
    to: equipmentTask.owner_id,
    subject: modelDraft.subject,
    body: modelDraft.body,
    status: "pending",
    created_at: now,
  };
  if (!registerDraft(draft)) throw new Error(`Demo draft was not registered: ${draft.id}`);
  c.drafts.push({ ...draft });

  const slackAction = requireAction("slack.send_message");
  const beforeApproval = await slackAction.action.run({ draft_id: draft.id, now });
  return {
    model: { provider: modelDraft.provider, model: modelDraft.model },
    draft,
    beforeApproval,
    trace: [
      { actor: "agent", kind: "model.draft", summary: `${modelDraft.provider} produced a bounded Slack nudge.` },
      { actor: "agent", kind: "draft.created", summary: `Draft ${draft.id} created for ${draft.action} and awaits approval.` },
      { actor: "system", kind: "send.refused", summary: beforeApproval.summary },
    ],
  };
}

async function createDraftWithRecovery(
  c: Case,
  joiner: Joiner,
  equipment: ToolResult,
  facts: DemoFacts,
  now: string,
  mode: string,
): Promise<DraftState> {
  try {
    return await createDraftForCurrentState(c, joiner, equipment, facts, now, mode);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown drafting failure";
    return {
      model: modelMetadata(mode),
      draft: null,
      beforeApproval: null,
      unavailable: { message: DRAFT_UNAVAILABLE_MESSAGE },
      trace: [{ actor: "system", kind: "draft.unavailable", summary: `Draft generation failed after the state change: ${detail}` }],
    };
  }
}

export async function prepareDemo(now = DEMO_NOW, mode = process.env.DEMO_MODE ?? "mock"): Promise<DemoPreparation> {
  resetDemoState();
  const runId = nextRunId();

  const event = EVENTS.find((candidate) => candidate.event_id === DEMO_EVENT_ID && candidate.type === "contract.signed");
  if (!event) throw new Error(`Demo event is not registered: ${DEMO_EVENT_ID}`);
  const joiner = joinerById(event.joiner_id);
  if (!joiner) throw new Error(`Demo joiner is not registered: ${event.joiner_id}`);

  const store = new CaseStore();
  const opened = store.open(event, joiner, now);
  if (!opened.case || opened.outcome !== "opened") throw new Error(`Demo case did not open: ${opened.outcome}`);
  const c = opened.case;
  const trace = traceFromCase(c);

  const equipmentAction = requireAction("equipment.order");
  if (authorize("equipment.order").mode !== "automatic") throw new Error("Demo equipment action is not automatic");
  const equipment = await equipmentAction.action.run({
    joiner_id: joiner.id,
    model: joiner.equipment_preference,
    ship_to: joiner.work_mode === "remote" ? "home" : "office",
    now,
  });
  recordCaseStep(c, "agent", "tool.equipment.order", equipment.summary, now, { status: equipment.status });
  trace.push({ actor: "agent", kind: "tool.equipment.order", summary: equipment.summary });
  const facts = buildDemoFacts(c, event, joiner, equipment);
  const agent = await runAgent(c, joiner, "contract.signed", now, mode === "live" ? "live" : "mock");
  const generatedDraft = agent.proposals.find((proposal) => proposal.draft.kind === "nudge");
  const buddyProposal = agent.proposals.find((proposal) => proposal.draft.kind === "buddy_intro");
  const availability = agent.availability ?? await readBuddyAvailability(joiner, c.start_date, [], c.id);
  const availabilitySummary = availability.recommendation
    ? `Recommended ${availability.recommendation.candidate_name} from the current first-week calendar snapshot.`
    : availability.escalation?.summary ?? "No buddy recommendation is available from the current facts.";
  const generated = agent.stop_reason === "finished"
    ? {
      model: { provider: agent.provider, model: agent.model } as Pick<NudgeModelDraft, "provider" | "model">,
      draft: generatedDraft?.draft ?? null,
      beforeApproval: generatedDraft?.before_approval ?? null,
      unavailable: undefined,
      trace: agent.trace,
    }
    : {
      model: { provider: agent.provider, model: agent.model } as Pick<NudgeModelDraft, "provider" | "model">,
      draft: null,
      beforeApproval: null,
      unavailable: { message: `Assistant unavailable (${agent.stop_reason}). The case is unchanged; run assistant again.` },
      trace: agent.trace,
    };
  let proposalIndex = 0;
  const agentTrace = agent.trace.flatMap((entry) => {
    const entries = [entry];
    if (entry.kind === "agent.tool_result" && (entry.summary.startsWith("Recommended") || entry.summary.startsWith("No suitable buddy"))) {
      entries.push({ actor: "agent" as const, kind: "tool.buddy_directory.get_availability", summary: availabilitySummary });
    }
    if (entry.kind === "agent.proposed") {
      const proposal = agent.proposals[proposalIndex++];
      if (proposal) {
        entries.push({ actor: "agent" as const, kind: proposal.request ? "buddy.request.prepared" : "draft.created", summary: proposal.request
          ? `Prepared a fixed buddy request for ${proposal.request.candidate_id} with two proposed first-week slots.`
          : `Draft ${proposal.draft.id} created for ${proposal.draft.action} and awaits approval.` });
        if (proposal.request) entries.push({ actor: "agent" as const, kind: "draft.created", summary: `Draft ${proposal.draft.id} created for the buddy request and awaits People approval.` });
        entries.push({ actor: "system" as const, kind: "send.refused", summary: proposal.before_approval.summary });
      }
    }
    return entries;
  });

  return {
    run_id: runId,
    case: c,
    event,
    joiner,
    agent,
    model: generated.model,
    draft: generated.draft,
    equipment,
    beforeApproval: generated.beforeApproval,
    facts,
    buddy: buddyState(availability, buddyProposal?.request ?? latestBuddyRequest(c), buddyProposal?.draft ?? null, buddyProposal?.before_approval),
    draft_unavailable: generated.unavailable,
    trace: [...trace, ...agentTrace],
    store,
  };
}

export async function changeDemoStartDate(
  preparation: DemoPreparation,
  newStartDate: string,
  mode = process.env.DEMO_MODE ?? "mock",
  now = DEMO_NOW,
): Promise<DemoPreparation> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newStartDate) || !Number.isFinite(Date.parse(`${newStartDate}T00:00:00Z`))) {
    throw new Error("start_date must be a valid ISO date");
  }
  const previousStartDate = preparation.case.start_date;
  if (newStartDate === previousStartDate) {
    if (!preparation.draft_unavailable) throw new Error("Choose a different start date to recalculate the case");
    return retryDemoDraft(preparation, mode, now);
  }

  const supersededDraftId = preparation.draft?.id;
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
  const generated = await createDraftWithRecovery(recomputed.case, updatedJoiner, preparation.equipment, facts, now, mode);
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
    { actor: "agent" as const, kind: "tool.buddy_directory.get_availability", summary: availability.recommendation ? `Recommended ${availability.recommendation.candidate_name} for the revised first week.` : availability.escalation?.summary ?? "No buddy recommendation is available for the revised first week." },
    ...generated.trace,
  ];

  return {
    ...preparation,
    run_id: `DEMO-RUN-${randomUUID()}`,
    case: recomputed.case,
    joiner: updatedJoiner,
    model: generated.model,
    draft: generated.draft,
    beforeApproval: generated.beforeApproval,
    facts,
    buddy: buddyState(availability, latestBuddyRequest(recomputed.case)),
    date_change: dateChange,
    draft_unavailable: generated.unavailable,
    trace,
  };
}

export async function retryDemoDraft(
  preparation: DemoPreparation,
  mode = process.env.DEMO_MODE ?? "mock",
  now = DEMO_NOW,
): Promise<DemoPreparation> {
  if (!preparation.draft_unavailable) throw new Error("Demo has no unavailable draft to retry");
  const facts = buildDemoFacts(preparation.case, preparation.event, preparation.joiner, preparation.equipment);
  const generated = await createDraftWithRecovery(preparation.case, preparation.joiner, preparation.equipment, facts, now, mode);
  return {
    ...preparation,
    run_id: `DEMO-RUN-${randomUUID()}`,
    model: generated.model,
    draft: generated.draft,
    beforeApproval: generated.beforeApproval,
    facts,
    draft_unavailable: generated.unavailable,
    trace: [
      ...preparation.trace,
      { actor: "system", kind: "draft.retry", summary: `Retried drafting for the current ${facts.start_date} case state.` },
      ...generated.trace,
    ],
  };
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
      { actor: "system", kind: "send.refused", summary: beforeApproval.summary },
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
  recordCaseStep(preparation.case, "agent", "buddy.request.prepared", `Prepared a fixed buddy request for ${selected.candidate.full_name} with two proposed first-week slots.`, now, {
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
      { actor: "agent", kind: "buddy.request.prepared", summary: `Prepared a fixed buddy request for ${selected.candidate.full_name} with two proposed first-week slots.` },
      { actor: "agent", kind: "draft.created", summary: `Draft ${draft.id} created for the buddy request and awaits People approval.` },
      { actor: "system", kind: "send.refused", summary: beforeApproval.summary },
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
  const updated: DemoPreparation = {
    ...preparation,
    run_id: nextRunId(),
    buddy: buddyState(availability, request),
    trace: [
      ...preparation.trace,
      { actor: "system", kind: "buddy.request.invalidated", summary: `Buddy request ${request.id} was invalidated because the current availability no longer matches the reviewed proposal.` },
      { actor: "agent", kind: "tool.buddy_directory.get_availability", summary: availability.recommendation ? `Recommended ${availability.recommendation.candidate_name} from the refreshed availability.` : availability.escalation?.summary ?? "No buddy recommendation is available from the refreshed availability." },
    ],
  };
  return { preparation: updated, conflict: `${reason} The old request cannot be approved or confirmed; prepare a new request from the refreshed facts.` };
}

export async function simulateBuddyAvailabilityChange(
  preparation: DemoPreparation,
  candidateId: string,
  now = DEMO_NOW,
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
  const candidate = availability.candidates.find((assessment) => assessment.candidate.id === candidateId);
  const availabilitySummary = candidate
    ? `${candidate.candidate.full_name} is now ${candidate.availability.status}: ${candidate.availability.reason}`
    : `${buddyName(candidateId)} is no longer in the current comparison.`;
  const requestSummary = affectsCurrentRequest && request
    ? `Request ${request.id} was invalidated because its simulated calendar changed.`
    : undefined;

  return {
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
      { actor: "agent", kind: "tool.buddy_directory.get_availability", summary: availabilitySummary },
    ],
  };
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
    : `${buddyName(request.candidate_id)} declined request ${request.id}; no replacement request was sent.`;
  updateBuddyTask(preparation.case, "open", response === "accepted" ? `Awaiting People confirmation of ${buddyName(request.candidate_id)}.` : `Buddy request ${request.id} declined; People must choose another candidate.`);
  recordCaseStep(preparation.case, "system", "buddy.response.simulated", summary, now, {
    request_id: request.id,
    candidate_id: request.candidate_id,
    response,
  });
  const availability = await readBuddyAvailability(preparation.joiner, preparation.case.start_date, declinedBuddyIds(preparation.case), preparation.case.id);
  return {
    preparation: {
      ...preparation,
      run_id: nextRunId(),
      buddy: buddyState(availability, request, preparation.buddy.draft, preparation.buddy.beforeApproval, preparation.buddy.afterApproval),
      trace: [
        ...preparation.trace,
        { actor: "system", kind: "buddy.response.simulated", summary },
        { actor: "agent", kind: "tool.buddy_directory.get_availability", summary: availability.recommendation ? `Recommended ${availability.recommendation.candidate_name} as the next candidate.` : availability.escalation?.summary ?? "No replacement buddy recommendation is available." },
      ],
    },
  };
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
  const preparation = await prepareDemo(now);
  const resolution = await resolveDemoApproval(preparation, "approve", "pp-1", now);
  const slackAction = requireAction("slack.send_message");
  const retry = await slackAction.action.run({ draft_id: resolution.draft.id, now });
  const trace = [...resolution.trace, { actor: "system" as const, kind: "send.retried", summary: retry.summary }];
  return { ...preparation, ...resolution, approved: true, retry, trace };
}
