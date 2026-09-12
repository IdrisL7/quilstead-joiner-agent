import { EVENTS } from "@/data/events";
import { joinerById } from "@/data/joiners";
import { personById } from "@/data/people";
import { authorize } from "@/lib/permissions";
import { findAction } from "@/lib/connectors/registry";
import {
  approveDraft,
  rejectDraft,
  registerDraft,
} from "@/lib/connectors/simulated/messaging";
import { draftEquipmentNudge, type NudgeModelDraft } from "@/lib/model";
import { CaseStore } from "@/lib/store/case-store";
import { resetDemoState } from "@/lib/store/demo-state";
import type { Case, Draft, HrisEvent, Joiner, ToolResult } from "@/lib/types";

const DEMO_NOW = "2026-09-30T09:00:00Z";
const DEMO_EVENT_ID = "EVT-004";
const DEMO_DRAFT_ID = "DRAFT-DEMO-001";
const DEMO_RUN_ID = "DEMO-RUN-001";

export type DemoDecision = "approve" | "reject";

export interface DemoTraceEntry {
  actor: "system" | "agent" | "human";
  kind: string;
  summary: string;
}

export interface DemoPreparation {
  run_id: string;
  case: Case;
  event: HrisEvent;
  joiner: Joiner;
  model: Pick<NudgeModelDraft, "provider" | "model">;
  draft: Draft;
  equipment: ToolResult;
  beforeApproval: ToolResult;
  trace: DemoTraceEntry[];
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
  trace: DemoTraceEntry[];
}

export interface DemoRun extends DemoPreparation {
  approved: boolean;
  afterApproval: ToolResult;
  retry: ToolResult;
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

export async function prepareDemo(now = DEMO_NOW, mode = process.env.DEMO_MODE ?? "mock"): Promise<DemoPreparation> {
  resetDemoState();

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
  if (equipment.status !== "warning" || !equipment.data || typeof equipment.data !== "object" || !("eta" in equipment.data)) {
    throw new Error(`Demo expected a backordered equipment result, received: ${equipment.status}`);
  }

  const equipmentTask = c.tasks.find((task) => task.type === "equipment_order");
  if (!equipmentTask) throw new Error("Demo equipment task is missing from the plan");
  const ownerName = personById(equipmentTask.owner_id)?.full_name ?? equipmentTask.owner_id;
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
      data: { eta: String(equipment.data.eta), status: "backordered" },
    },
    equipmentTask,
    ownerName,
  }, mode);

  const draft: Draft = {
    id: DEMO_DRAFT_ID,
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
  trace.push({ actor: "agent", kind: "model.draft", summary: `${modelDraft.provider} produced a bounded Slack nudge.` });
  trace.push({ actor: "agent", kind: "draft.created", summary: `Draft ${draft.id} created for ${draft.action} and awaits approval.` });

  const slackAction = requireAction("slack.send_message");
  const beforeApproval = await slackAction.action.run({ draft_id: draft.id, now });
  trace.push({ actor: "system", kind: "send.refused", summary: beforeApproval.summary });

  return {
    run_id: DEMO_RUN_ID,
    case: c,
    event,
    joiner,
    model: { provider: modelDraft.provider, model: modelDraft.model },
    draft,
    equipment,
    beforeApproval,
    trace,
  };
}

export async function resolveDemoApproval(
  preparation: DemoPreparation,
  decision: DemoDecision,
  decidedBy = "pp-1",
  now = DEMO_NOW,
): Promise<DemoResolution> {
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
