import { EVENTS } from "@/data/events";
import { joinerById } from "@/data/joiners";
import { authorize } from "@/lib/permissions";
import { findAction } from "@/lib/connectors/registry";
import {
  approveDraft,
  registerDraft,
} from "@/lib/connectors/simulated/messaging";
import { CaseStore } from "@/lib/store/case-store";
import { resetDemoState } from "@/lib/store/demo-state";
import type { Case, Draft, HrisEvent, Joiner, ToolResult } from "@/lib/types";

const DEMO_NOW = "2026-09-30T09:00:00Z";
const DEMO_EVENT_ID = "EVT-004";
const DEMO_DRAFT_ID = "DRAFT-DEMO-001";

export interface DemoTraceEntry {
  actor: "system" | "agent" | "human";
  kind: string;
  summary: string;
}

export interface DemoRun {
  case: Case;
  event: HrisEvent;
  joiner: Joiner;
  draft: Draft;
  equipment: ToolResult;
  beforeApproval: ToolResult;
  approved: boolean;
  afterApproval: ToolResult;
  retry: ToolResult;
  trace: DemoTraceEntry[];
}

function requireAction(tool: string) {
  const resolved = findAction(tool);
  if (!resolved) throw new Error(`Demo action is not registered: ${tool}`);
  return resolved;
}

function draftNudge(joiner: Joiner, c: Case, ownerId: string, now: string, eta: string): Draft {
  // Mock mode keeps this path deterministic. The future model loop can replace only this function.
  return {
    id: DEMO_DRAFT_ID,
    case_id: c.id,
    kind: "nudge",
    action: "slack.send_message",
    channel: "slack",
    to: ownerId,
    subject: `Equipment order needs attention for ${joiner.preferred_name}`,
    body: `The ${joiner.preferred_name} laptop order is backordered. Please confirm the revised ETA of ${eta}.`,
    status: "pending",
    created_at: now,
  };
}

function traceFromCase(c: Case): DemoTraceEntry[] {
  return c.steps.map((step) => ({ actor: step.actor, kind: step.kind, summary: step.summary }));
}

export async function runDemo(now = DEMO_NOW): Promise<DemoRun> {
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
  const draft = draftNudge(joiner, c, equipmentTask.owner_id, now, String(equipment.data.eta));
  if (!registerDraft(draft)) throw new Error(`Demo draft was not registered: ${draft.id}`);
  c.drafts.push({ ...draft });
  trace.push({ actor: "agent", kind: "draft.created", summary: `Draft ${draft.id} created for ${draft.action} and awaits approval.` });

  const slackAction = requireAction("slack.send_message");
  const beforeApproval = await slackAction.action.run({ draft_id: draft.id, now });
  trace.push({ actor: "system", kind: "send.refused", summary: beforeApproval.summary });

  const approved = approveDraft(draft.id, "pp-1", now);
  if (approved) {
    const caseDraft = c.drafts.find((candidate) => candidate.id === draft.id);
    if (caseDraft) {
      caseDraft.status = "approved";
      caseDraft.decided_by = "pp-1";
      caseDraft.decided_at = now;
    }
  }
  trace.push({ actor: "human", kind: "draft.approved", summary: approved ? `Draft ${draft.id} approved by pp-1.` : `Draft ${draft.id} was not approved.` });

  const afterApproval = await slackAction.action.run({ draft_id: draft.id, now });
  trace.push({ actor: "system", kind: "send.completed", summary: afterApproval.summary });
  const retry = await slackAction.action.run({ draft_id: draft.id, now });
  trace.push({ actor: "system", kind: "send.retried", summary: retry.summary });

  return { case: c, event, joiner, draft: c.drafts.find((candidate) => candidate.id === draft.id) ?? draft, equipment, beforeApproval, approved, afterApproval, retry, trace };
}
