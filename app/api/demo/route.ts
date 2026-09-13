import { NextResponse } from "next/server";
import { buddyById } from "@/data/buddies";
import { personById } from "@/data/people";
import { attentionSummary } from "@/lib/attention";
import {
  BuddyFlowConflict,
  changeDemoStartDate,
  confirmBuddy,
  editDemoEquipmentDraft,
  prepareDemo,
  prepareBuddyRequest,
  retryDemoDraft,
  recordBuddyResponse,
  resolveBuddyApproval,
  resolveDemoApproval,
  simulateBuddyAvailabilityChange,
  type DemoDecision,
  type DemoPreparation,
} from "@/lib/demo-flow";
import type { BuddyResponse, BuddyRequest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let activeRun: DemoPreparation | null = null;
let mutationInFlight = false;

function caseSummary(run: DemoPreparation) {
  const buddyTask = run.case.tasks.find((task) => task.type === "buddy_allocation");
  return {
    id: run.case.id,
    state: run.case.state,
    start_date: run.case.start_date,
    task_count: run.case.tasks.length,
    buddy_id: run.case.buddy_id ?? null,
    buddy_task_status: buddyTask?.status ?? null,
    buddy_task_done_by: buddyTask?.done_by ?? null,
  };
}

function equipmentSummary(run: DemoPreparation) {
  const data = run.equipment.data;
  const eta = data && typeof data === "object" && "eta" in data ? String(data.eta) : null;
  return { status: run.equipment.status, summary: run.equipment.summary, eta };
}

function draftSummary(run: DemoPreparation) {
  if (!run.draft) return null;
  return {
    id: run.draft.id,
    kind: run.draft.kind,
    action: run.draft.action,
    channel: run.draft.channel,
    recipient: personById(run.draft.to)?.full_name ?? run.draft.to,
    subject: run.draft.subject,
    body: run.draft.body,
    status: run.draft.status,
    revision: run.draft.revision,
    edited_by: run.draft.edited_by,
    edited_at: run.draft.edited_at,
    supersedes_draft_id: run.draft.supersedes_draft_id,
    decided_by: run.draft.decided_by,
    decision_reason: run.draft.decision_reason,
  };
}

function buddyDraftSummary(run: DemoPreparation) {
  const draft = run.buddy.draft;
  if (!draft) return null;
  return {
    id: draft.id,
    kind: draft.kind,
    action: draft.action,
    channel: draft.channel,
    recipient: buddyById(draft.to)?.full_name ?? draft.to,
    subject: draft.subject,
    body: draft.body,
    status: draft.status,
    decided_by: draft.decided_by,
    decision_reason: draft.decision_reason,
  };
}

function buddyRequestSummary(request: BuddyRequest | null) {
  if (!request) return null;
  return {
    id: request.id,
    draft_id: request.draft_id,
    candidate_id: request.candidate_id,
    candidate_name: buddyById(request.candidate_id)?.full_name ?? request.candidate_id,
    start_date: request.start_date,
    slots: request.slots,
    status: request.status,
    created_at: request.created_at,
    sent_at: request.sent_at,
    response: request.response,
    responded_at: request.responded_at,
    confirmed_at: request.confirmed_at,
    confirmed_by: request.confirmed_by,
    confirmed_by_name: request.confirmed_by ? personById(request.confirmed_by)?.full_name ?? request.confirmed_by : undefined,
    invalidated_at: request.invalidated_at,
    invalidation_reason: request.invalidation_reason,
  };
}

function buddySummary(run: DemoPreparation) {
  return {
    availability: run.buddy.availability,
    request: buddyRequestSummary(run.buddy.request),
    draft: buddyDraftSummary(run),
    before_approval: run.buddy.beforeApproval,
    after_approval: run.buddy.afterApproval,
  };
}

function agentSummary(run: DemoPreparation) {
  if (!run.agent) return null;
  return {
    run_id: run.agent.run_id,
    trigger: run.agent.trigger,
    provider: run.agent.provider,
    model: run.agent.model,
    steps: run.agent.model_steps,
    tool_calls: run.agent.tool_calls,
    refused: run.agent.refused,
    stop_reason: run.agent.stop_reason,
    next_action: run.agent.next_action,
    cost_usd: run.agent.cost_usd,
    started_at: run.agent.started_at,
    finished_at: run.agent.finished_at,
  };
}

function preparationResponse(run: DemoPreparation) {
  return {
    phase: "pending" as const,
    screen_state: run.decision
      ? "resolved" as const
      : run.draft
      ? "awaiting_decision" as const
      : run.draft_unavailable
        ? "draft_unavailable" as const
        : "no_action" as const,
    run_id: run.run_id,
    case: caseSummary(run),
    joiner: {
      full_name: run.joiner.full_name,
      title: run.joiner.title,
      office: run.joiner.office,
      work_mode: run.joiner.work_mode,
      start_date: run.joiner.start_date,
    },
    model: run.model,
    agent: agentSummary(run),
    equipment: equipmentSummary(run),
    attention: attentionSummary(run),
    facts: run.facts,
    draft: draftSummary(run),
    before_approval: run.beforeApproval,
    decision: run.decision,
    after_approval: run.afterApproval,
    buddy: buddySummary(run),
    date_change: run.date_change,
    draft_unavailable: run.draft_unavailable,
    trace: run.trace,
  };
}

export async function POST(request: Request) {
  if (mutationInFlight) {
    return NextResponse.json({ error: "Another demo mutation is in progress. Retry with the current run." }, { status: 409 });
  }
  mutationInFlight = true;
  try {
    const body = await request.json() as {
      run_id?: unknown;
      decision?: unknown;
      action?: unknown;
      start_date?: unknown;
      candidate_id?: unknown;
      request_id?: unknown;
      draft_id?: unknown;
      subject?: unknown;
      body?: unknown;
      response?: unknown;
    };
    if (body.action && typeof body.run_id !== "string") {
      return NextResponse.json({ error: "A current run is required for this demo mutation." }, { status: 409 });
    }
    if (typeof body.run_id === "string") {
      if (!activeRun || body.run_id !== activeRun.run_id) {
        return NextResponse.json({ error: "This approval run is no longer active. Start a new run." }, { status: 409 });
      }
      const preparation = activeRun;
      if (body.action === "start_date_change") {
        if (typeof body.start_date !== "string") {
          return NextResponse.json({ error: "start_date is required for a start-date change" }, { status: 400 });
        }
        const updated = await changeDemoStartDate(preparation, body.start_date);
        activeRun = updated;
        return NextResponse.json(preparationResponse(updated));
      }
      if (body.action === "retry_draft") {
        const updated = await retryDemoDraft(preparation);
        activeRun = updated;
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "edit_equipment_draft") {
        const updated = await editDemoEquipmentDraft(preparation, body.draft_id, body.subject, body.body, "pp-1");
        activeRun = updated;
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "buddy_availability_change") {
        if (typeof body.candidate_id !== "string") {
          return NextResponse.json({ error: "candidate_id is required for a simulated availability change" }, { status: 400 });
        }
        const updated = await simulateBuddyAvailabilityChange(preparation, body.candidate_id);
        activeRun = updated;
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "buddy_prepare") {
        const updated = await prepareBuddyRequest(preparation, typeof body.candidate_id === "string" ? body.candidate_id : undefined);
        activeRun = updated;
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "buddy_decision") {
        if (typeof body.request_id !== "string" || typeof body.draft_id !== "string") {
          return NextResponse.json({ error: "request_id and draft_id are required for a buddy decision" }, { status: 400 });
        }
        if (body.decision !== "approve" && body.decision !== "reject") {
          return NextResponse.json({ error: "decision must be approve or reject" }, { status: 400 });
        }
        const result = await resolveBuddyApproval(preparation, body.request_id, body.draft_id, body.decision as "approve" | "reject", "pp-1");
        activeRun = result.preparation;
        if (result.conflict) {
          return NextResponse.json({ error: result.conflict, ...preparationResponse(result.preparation) }, { status: 409 });
        }
        return NextResponse.json(preparationResponse(result.preparation));
      }

      if (body.action === "buddy_response") {
        if (typeof body.request_id !== "string") {
          return NextResponse.json({ error: "request_id is required for a buddy response" }, { status: 400 });
        }
        if (body.response !== "accepted" && body.response !== "declined") {
          return NextResponse.json({ error: "response must be accepted or declined" }, { status: 400 });
        }
        const result = await recordBuddyResponse(preparation, body.request_id, body.response as BuddyResponse);
        activeRun = result.preparation;
        return NextResponse.json(preparationResponse(result.preparation));
      }

      if (body.action === "buddy_confirm") {
        if (typeof body.request_id !== "string") {
          return NextResponse.json({ error: "request_id is required for People confirmation" }, { status: 400 });
        }
        const result = await confirmBuddy(preparation, body.request_id, "pp-1");
        activeRun = result.preparation;
        if (result.conflict) {
          return NextResponse.json({ error: result.conflict, ...preparationResponse(result.preparation) }, { status: 409 });
        }
        return NextResponse.json(preparationResponse(result.preparation));
      }

      if (body.decision !== "approve" && body.decision !== "reject") {
        return NextResponse.json({ error: "decision must be approve or reject" }, { status: 400 });
      }
      if (!preparation.draft) {
        return NextResponse.json({ error: "There is no current draft requiring approval" }, { status: 409 });
      }
      if (preparation.decision || preparation.draft.kind !== "nudge" || preparation.draft.status !== "pending") {
        return NextResponse.json({ error: "The equipment draft is no longer awaiting a decision" }, { status: 409 });
      }
      const resolution = await resolveDemoApproval(preparation, body.decision as DemoDecision, "pp-1");
      const updated: DemoPreparation = {
        ...preparation,
        run_id: resolution.run_id,
        decision: resolution.decision,
        afterApproval: resolution.afterApproval,
        draft: resolution.draft,
        buddy: resolution.buddy,
        trace: resolution.trace,
      };
      activeRun = updated;
      return NextResponse.json({
        ...preparationResponse(updated),
        decision: resolution.decision,
        draft: {
          ...draftSummary(updated),
          status: resolution.draft.status,
          decided_by: resolution.draft.decided_by,
          decision_reason: resolution.draft.decision_reason,
        },
        after_approval: resolution.afterApproval,
        trace: resolution.trace,
      });
    }

    const preparation = await prepareDemo();
    activeRun = preparation;
    return NextResponse.json(preparationResponse(preparation));
  } catch (error) {
    if (error instanceof BuddyFlowConflict) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Demo flow failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    mutationInFlight = false;
  }
}
