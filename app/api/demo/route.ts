import { NextResponse } from "next/server";
import { buddyById } from "@/data/buddies";
import { personById } from "@/data/people";
import {
  BuddyFlowConflict,
  changeDemoStartDate,
  confirmBuddy,
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

function attentionSummary(run: DemoPreparation) {
  const buddyTask = run.case.tasks.find((task) => task.type === "buddy_allocation");
  const complianceTasks = run.case.tasks.filter((task) => task.compliance_code);
  const openComplianceTasks = complianceTasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const unresolvedEscalations = run.case.escalations.filter((escalation) => !escalation.resolved_at);
  const complianceEscalationCodes = new Set<string>(["RTW_NOT_EVIDENCED", "COMPLIANCE_DEADLINE_AT_RISK"]);
  const unresolvedComplianceEscalations = unresolvedEscalations.filter((escalation) => complianceEscalationCodes.has(escalation.code));
  const primaryComplianceTask = openComplianceTasks.find((task) => task.status === "escalated") ?? openComplianceTasks[0];
  const complianceNextAction = primaryComplianceTask
    ? `${primaryComplianceTask.status === "escalated" ? "Resolve" : "Complete"} ${primaryComplianceTask.title}.`
    : unresolvedComplianceEscalations[0]?.summary ?? "No open compliance task is due by the current start date.";
  const screenState = run.decision
    ? "resolved"
    : run.draft
    ? "awaiting_decision"
    : run.draft_unavailable
    ? "draft_unavailable"
    : "no_action";
  const equipmentStatus = !run.facts.equipment_late
    ? "On track"
    : run.decision === "approve"
    ? "Awaiting IT response"
    : screenState === "draft_unavailable"
    ? "Draft unavailable"
    : screenState === "awaiting_decision"
    ? "Needs approval"
    : "Needs review";
  const equipmentNextAction = !run.facts.equipment_late
    ? "No equipment action required from the current dates."
    : run.decision === "approve"
    ? "Wait for IT to arrange a loaner or earlier delivery."
    : screenState === "draft_unavailable"
    ? "Retry the draft before any message can be sent."
    : "Review the current equipment nudge.";

  let buddyStatus = "Ready for review";
  let buddyNextAction = run.buddy.availability.recommendation
    ? "Compare candidates and request support."
    : run.buddy.availability.escalation?.summary ?? "People must review buddy support by hand.";
  if (run.buddy.request?.status === "pending_approval") {
    buddyStatus = "Awaiting approval";
    buddyNextAction = "Approve or reject the exact buddy request.";
  } else if (run.buddy.request?.status === "awaiting_acceptance") {
    buddyStatus = "Awaiting buddy acceptance";
    buddyNextAction = "Use the labelled simulation response control.";
  } else if (run.buddy.request?.status === "accepted" && buddyTask?.status !== "done") {
    buddyStatus = "Awaiting People confirmation";
    buddyNextAction = "Confirm the accepted allocation as People.";
  } else if (run.buddy.request?.status === "confirmed" && buddyTask?.status === "done") {
    buddyStatus = "Confirmed";
    buddyNextAction = "People confirmation is recorded for this case.";
  } else if (run.buddy.request?.status === "declined" || run.buddy.request?.status === "rejected") {
    buddyStatus = "Needs replacement";
    buddyNextAction = "Choose another candidate. No request was sent automatically.";
  } else if (run.buddy.request?.status === "superseded") {
    buddyStatus = "Needs revalidation";
    buddyNextAction = "Prepare a fresh request from the current availability.";
  }

  return {
    equipment: {
      status: equipmentStatus,
      owner_name: run.facts.equipment_owner_name,
      next_action: equipmentNextAction,
    },
    buddy: {
      status: buddyStatus,
      owner_name: personById(buddyTask?.owner_id ?? "")?.full_name ?? buddyTask?.owner_id ?? "People",
      next_action: buddyNextAction,
      candidate_name: run.buddy.request
        ? buddyById(run.buddy.request.candidate_id)?.full_name ?? run.buddy.request.candidate_id
        : run.buddy.availability.recommendation?.candidate_name ?? null,
    },
    compliance: {
      status: unresolvedComplianceEscalations.some((escalation) => escalation.severity === "critical")
        ? "Blocked"
        : openComplianceTasks.length > 0
        ? "In progress"
        : "Complete",
      owner_name: personById(primaryComplianceTask?.owner_id ?? unresolvedComplianceEscalations[0]?.to_person_id ?? "")?.full_name ?? "People",
      next_action: complianceNextAction,
      open_tasks: openComplianceTasks.length,
      total_tasks: complianceTasks.length,
      unresolved_escalations: unresolvedComplianceEscalations.length,
    },
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
      response?: unknown;
    };
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
