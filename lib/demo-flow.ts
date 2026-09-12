import { randomUUID } from "node:crypto";
import { EVENTS } from "@/data/events";
import { joinerById } from "@/data/joiners";
import { personById } from "@/data/people";
import { authorize } from "@/lib/permissions";
import { findAction } from "@/lib/connectors/registry";
import { loadKb } from "@/lib/connectors/simulated/policy-kb";
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
import type { Case, Draft, HrisEvent, Joiner, ToolResult } from "@/lib/types";

const DEMO_NOW = "2026-09-30T09:00:00Z";
const DEMO_EVENT_ID = "EVT-004";
const EQUIPMENT_POLICY_ID = "equipment-policy";
const EQUIPMENT_POLICY_QUOTE = "IT orders equipment within five working days of the contract being signed.";

export type DemoDecision = "approve" | "reject";

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
}

export interface DemoPreparation {
  run_id: string;
  case: Case;
  event: HrisEvent;
  joiner: Joiner;
  model: Pick<NudgeModelDraft, "provider" | "model">;
  draft: Draft | null;
  equipment: ToolResult;
  beforeApproval: ToolResult | null;
  facts: DemoFacts;
  date_change?: DemoDateChange;
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
  date_change?: DemoDateChange;
  trace: DemoTraceEntry[];
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
  trace: DemoTraceEntry[];
}

function requireAction(tool: string) {
  const resolved = findAction(tool);
  if (!resolved) throw new Error(`Demo action is not registered: ${tool}`);
  return resolved;
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

export async function prepareDemo(now = DEMO_NOW, mode = process.env.DEMO_MODE ?? "mock"): Promise<DemoPreparation> {
  resetDemoState();
  const runId = `DEMO-RUN-${randomUUID()}`;

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
  trace.push({ actor: "agent", kind: "tool.equipment.order", summary: equipment.summary });
  const facts = buildDemoFacts(c, event, joiner, equipment);
  const generated = await createDraftForCurrentState(c, joiner, equipment, facts, now, mode);

  return {
    run_id: runId,
    case: c,
    event,
    joiner,
    model: generated.model,
    draft: generated.draft,
    equipment,
    beforeApproval: generated.beforeApproval,
    facts,
    trace: [...trace, ...generated.trace],
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
  if (newStartDate === previousStartDate) throw new Error("Choose a different start date to recalculate the case");

  const supersededDraftId = preparation.draft?.id;
  if (supersededDraftId) {
    const reason = "Superseded by a start-date change before approval.";
    if (!supersedeDraft(supersededDraftId, now, reason)) throw new Error(`Demo draft could not be superseded: ${supersededDraftId}`);
    markCaseDraftSuperseded(preparation.case, supersededDraftId, now, reason);
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
  const generated = await createDraftForCurrentState(recomputed.case, updatedJoiner, preparation.equipment, facts, now, mode);
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
  };
  const trace = [
    ...preparation.trace,
    { actor: "system" as const, kind: "start_date.changed", summary: `Start date ${previousStartDate} -> ${newStartDate}; ${recomputed.deadlineChanged} deadlines moved and ${recomputed.changed} tasks reconciled.` },
    ...(supersededDraftId ? [{ actor: "system" as const, kind: "draft.superseded", summary: `Draft ${supersededDraftId} is unavailable after the start-date change.` }] : []),
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
    date_change: dateChange,
    trace,
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
    run_id: preparation.run_id,
    decision,
    case: preparation.case,
    joiner: preparation.joiner,
    model: preparation.model,
    draft,
    equipment: preparation.equipment,
    beforeApproval: preparation.beforeApproval,
    afterApproval,
    facts: preparation.facts,
    date_change: preparation.date_change,
    trace,
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
