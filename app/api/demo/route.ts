import { onboardingView } from "@/lib/onboarding-view";
import { NextResponse } from "next/server";
import { buddyById } from "@/data/buddies";
import { buddyCalendarById } from "@/data/buddy-calendars";
import { joinerById } from "@/data/joiners";
import { personById } from "@/data/people";
import { attentionSummary } from "@/lib/attention";
import { askCase } from "@/lib/agent/ask";
import { askIntentFor } from "@/lib/agent/mock-ask";
import { firstWorkingWeek } from "@/lib/policy/buddy-availability";
import { resetDemoState } from "@/lib/store/demo-state";
import {
  beginDemoMutation,
  commitDemoMutation,
  demoMutationIsCurrent,
  demoMutationInFlight,
  endDemoMutation,
  getDemoRun,
  getDemoStore,
  listDemoRuns,
  resetDemoSessionData,
} from "@/lib/store/demo-session";
import { equipmentMonitor, registerEquipmentMonitorCase, resetEquipmentMonitor } from "@/lib/monitor/equipment-monitor";
import { findAction } from "@/lib/connectors/registry";
import { discardDraft } from "@/lib/connectors/simulated/messaging";
import {
  BuddyFlowConflict,
  DemoInputError,
  EquipmentApprovalConflict,
  changeDemoStartDate,
  confirmBuddy,
  confirmManagerPlan,
  editDemoManagerDraft,
  editDemoEquipmentDraft,
  prepareDemo,
  prepareBuddyRequest,
  prepareManagerCoordination,
  requestDemoAccess,
  retryAgent,
  recordBuddyResponse,
  recordManagerResponse,
  resolveBuddyApproval,
  resolveManagerApproval,
  resolveDemoApproval,
  simulateBuddyAvailabilityChange,
  type DemoDecision,
  type DemoPreparation,
} from "@/lib/demo-flow";
import type { BuddyResponse, BuddyRequest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUPPORTED_JOINERS = ["J-004", "J-001"] as const;

function caseIdForJoiner(joinerId: string): string {
  return `CASE-${joinerId}`;
}

function supportedJoiner(value: unknown): value is typeof SUPPORTED_JOINERS[number] {
  return typeof value === "string" && SUPPORTED_JOINERS.includes(value as typeof SUPPORTED_JOINERS[number]);
}

class StaleDemoMutationError extends Error {}

function discardDetachedDrafts(run: DemoPreparation): void {
  const currentDraftIds = new Set(listDemoRuns().flatMap((current) => current.case.drafts.map((draft) => draft.id)));
  for (const draft of run.case.drafts) {
    if (!currentDraftIds.has(draft.id)) discardDraft(draft.id);
  }
}

function saveRun(run: DemoPreparation, mutationToken: string): DemoPreparation {
  if (commitDemoMutation(mutationToken, run)) return run;
  discardDetachedDrafts(run);
  throw new StaleDemoMutationError("This demo operation was cancelled by reset. Retry against the current case.");
}

async function openDemoCase(joinerId: typeof SUPPORTED_JOINERS[number], mutationToken: string): Promise<{ run: DemoPreparation; opened: boolean }> {
  const caseId = caseIdForJoiner(joinerId);
  const existing = getDemoRun(caseId);
  if (existing) {
    if (!demoMutationIsCurrent(mutationToken)) throw new StaleDemoMutationError("This demo operation was cancelled by reset.");
    registerEquipmentMonitorCase(existing);
    return { run: existing, opened: false };
  }
  const run = await prepareDemo(undefined, undefined, joinerId, getDemoStore());
  saveRun(run, mutationToken);
  registerEquipmentMonitorCase(run);
  return { run, opened: true };
}

function currentRun(body: { case_id?: unknown; run_id?: unknown }): DemoPreparation | null {
  if (typeof body.case_id !== "string" || typeof body.run_id !== "string") return null;
  const run = getDemoRun(body.case_id);
  return run?.run_id === body.run_id ? run : null;
}

function caseSummary(run: DemoPreparation) {
  const buddyTask = run.case.tasks.find((task) => task.type === "buddy_allocation");
  return {
    id: run.case.id,
    state: run.case.state,
    start_date: run.case.start_date,
    task_count: run.case.tasks.length,
    open_task_count: run.case.tasks.filter((task) => !["done", "cancelled"].includes(task.status)).length,
    buddy_id: run.case.buddy_id ?? null,
    buddy_task_status: buddyTask?.status ?? null,
    buddy_task_done_by: buddyTask?.done_by ?? null,
  };
}

function equipmentSummary(run: DemoPreparation) {
  const data = run.equipment.data;
  const eta = data && typeof data === "object" && "eta" in data ? String(data.eta) : null;
  return { status: run.equipment.status, summary: run.equipment.summary, eta, source_revision: run.equipment_observation.source_revision };
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

function localDateFor(timestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function buddyAvailabilitySummary(run: DemoPreparation) {
  const requestedWeek = new Set(firstWorkingWeek(run.buddy.availability.start_date));
  return {
    ...run.buddy.availability,
    candidates: run.buddy.availability.candidates.map((assessment) => {
      const snapshot = buddyCalendarById(assessment.candidate.id);
      if (!snapshot) return assessment;

      const canShowBusyIntervals = snapshot.read_status === "known"
        && ["available", "busy"].includes(assessment.availability.status);
      const busyIntervals = canShowBusyIntervals
        ? snapshot.busy_intervals.filter((interval) => requestedWeek.has(localDateFor(interval.start_at, snapshot.timezone)))
        : [];

      return {
        ...assessment,
        availability: {
          ...assessment.availability,
          timezone: assessment.availability.timezone ?? snapshot.timezone,
          working_hours: snapshot.working_hours,
          coverage_start_date: snapshot.coverage_start_date,
          coverage_end_date: snapshot.coverage_end_date,
          busy_intervals: busyIntervals,
        },
      };
    }),
  };
}

function buddySummary(run: DemoPreparation) {
  return {
    availability: buddyAvailabilitySummary(run),
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
    proposed: run.agent.proposals.length,
    escalated: run.agent.trace.filter((entry) => entry.kind === "agent.escalated").length,
    stop_reason: run.agent.stop_reason,
    next_action: run.agent.next_action,
    input_tokens: run.agent.input_tokens,
    output_tokens: run.agent.output_tokens,
    cost_usd: run.agent.cost_usd,
    started_at: run.agent.started_at,
    finished_at: run.agent.finished_at,
  };
}

function managerSummary(run: DemoPreparation) {
  const request = run.case.manager_plans?.at(-1) ?? null;
  if (!request) return { request: null, draft: null };
  const draft = run.case.drafts.find((candidate) => candidate.id === request.draft_id) ?? null;
  return {
    request: {
      ...request,
      manager_name: personById(request.manager_id)?.full_name ?? request.manager_id,
      confirmed_by_name: request.confirmed_by ? personById(request.confirmed_by)?.full_name ?? request.confirmed_by : null,
    },
    draft: draft ? {
      id: draft.id,
      recipient: personById(draft.to)?.full_name ?? draft.to,
      subject: draft.subject,
      body: draft.body,
      status: draft.status,
      revision: draft.revision,
      supersedes_draft_id: draft.supersedes_draft_id,
    } : null,
  };
}

const UI_AGENT_TRACE_KINDS = new Set([
  "agent.asked",
  "agent.guard.refused",
  "agent.proposed",
  "agent.escalated",
  "agent.finished",
  "agent.unavailable",
]);

const DRAFT_ID_PATTERN = /DRAFT-[a-z0-9-]+/gi;

function draftIds(summary: string): string[] {
  return summary.match(DRAFT_ID_PATTERN) ?? [];
}

function isObservationResult(summary: string): boolean {
  return [
    /^Read current state for /,
    /^Order .* (?:backordered|is on track|placed); ETA /,
    /^(?:Recommended|No suitable buddy|No eligible buddy)/,
    /^1 relevant policy pages matched$/,
    /^Citation verbatim$/,
    /^Pending (?:nudge|buddy_request) draft /,
    /^Escalation .* recorded for People\.$/,
    /^Agent run finished\.$/,
  ].some((pattern) => pattern.test(summary));
}

function traceForUi(run: DemoPreparation) {
  const proposedDraftIds = new Set(run.trace
    .filter((entry) => entry.kind === "agent.proposed")
    .flatMap((entry) => draftIds(entry.summary)));

  return run.trace.filter((entry) => {
    if (entry.kind === "agent.tool_call" || entry.kind === "agent.started") return false;
    if (entry.kind === "agent.tool_result" && isObservationResult(entry.summary)) return false;
    if ((entry.kind === "draft.created" || entry.kind === "buddy.request.prepared")
      && draftIds(entry.summary).some((id) => proposedDraftIds.has(id))) return false;
    return !entry.kind.startsWith("agent.") || UI_AGENT_TRACE_KINDS.has(entry.kind);
  });
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
    available_joiners: SUPPORTED_JOINERS.map((id) => {
      const joiner = joinerById(id)!;
      const existing = getDemoRun(caseIdForJoiner(id));
      return {
        id,
        case_id: caseIdForJoiner(id),
        full_name: joiner.full_name,
        title: joiner.title,
        start_date: existing?.case.start_date ?? joiner.start_date,
        opened: Boolean(existing),
      };
    }),
    case: caseSummary(run),
    onboarding: onboardingView(run.case, run.joiner),
    joiner: {
      id: run.joiner.id,
      full_name: run.joiner.full_name,
      title: run.joiner.title,
      office: run.joiner.office,
      work_mode: run.joiner.work_mode,
      start_date: run.joiner.start_date,
    },
    model: run.model,
    agent: agentSummary(run),
    equipment: equipmentSummary(run),
    equipment_observation: run.equipment_observation,
    attention: attentionSummary(run),
    next_action: currentNextAction(run),
    facts: run.facts,
    draft: draftSummary(run),
    before_approval: run.beforeApproval,
    decision: run.decision,
    after_approval: run.afterApproval,
    buddy: buddySummary(run),
    manager_coordination: managerSummary(run),
    date_change: run.date_change,
    draft_unavailable: run.draft_unavailable,
    trace: traceForUi(run),
  };
}

function readAskQuestion(value: unknown): { question: string } | { error: string } {
  if (typeof value !== "string") return { error: "question is required for Ask Athena" };
  const question = value.trim();
  if (!question) return { error: "Ask Athena needs a question" };
  if (question.length > 300) return { error: "Ask Athena questions must be 300 characters or fewer" };
  return { question };
}

// The model's next_action is historical output from the run that produced it. Current guidance
// is always rebuilt from the live case state so later approvals, receipts and responses cannot
// leave stale instructions in the banner or Ask Athena answers.
export function currentNextAction(run: DemoPreparation): string | null {
  const attention = attentionSummary(run);
  const open = [attention.equipment, attention.buddy]
    .filter((item) => !["On track", "Confirmed", "Complete"].includes(item.status))
    .map((item) => item.next_action.trim().replace(/\.$/, ""));
  const managerTask = run.case.tasks.find((task) => task.type === "manager_day_one_plan");
  const managerRequest = run.case.manager_plans?.at(-1) ?? null;
  const managerName = personById(managerRequest?.manager_id ?? managerTask?.owner_id ?? "")?.full_name ?? "the manager";
  if (managerTask && !["done", "cancelled"].includes(managerTask.status)) {
    if (!managerRequest) open.push(`Prepare the first-day plan request to ${managerName}`);
    else if (managerRequest.status === "pending_approval") open.push(`Approve or reject the exact first-day plan request to ${managerName}`);
    else if (managerRequest.status === "send_failed") open.push(`Retry delivery of the approved first-day plan request to ${managerName}`);
    else if (managerRequest.status === "awaiting_response") open.push(`Wait for ${managerName}'s first-day plan response`);
    else if (managerRequest.status === "responded") open.push("Confirm the manager's first-day plan as People");
    else if (managerRequest.status === "rejected") open.push(`Prepare a new first-day plan request to ${managerName}`);
    else if (managerRequest.status === "superseded") open.push(`Prepare a fresh first-day plan request to ${managerName} for the current start date`);
  }
  const missingAccess = onboardingView(run.case, run.joiner).access.filter((row) => !row.request_id).length;
  if (missingAccess > 0) open.push(`Submit ${missingAccess} remaining role access request${missingAccess === 1 ? "" : "s"}`);
  if (attention.compliance.status !== "Complete") open.push(attention.compliance.next_action.trim().replace(/\.$/, ""));
  if (open.length === 0) return "Nothing is waiting on a person for this case.";
  return `${open.join(". ")}.`;
}

function alignAskStatusNextAction<T extends { answer: string }>(answer: T, run: DemoPreparation, question: string): T {
  const nextAction = currentNextAction(run);
  if (askIntentFor(question) !== "status" || !nextAction) return answer;

  const nextMarker = answer.answer.search(/\sNext(?: human action)?\s*:/i);
  const text = nextMarker >= 0
    ? `${answer.answer.slice(0, nextMarker)} Next: ${nextAction}`
    : `${answer.answer} Next: ${nextAction}`;
  return { ...answer, answer: text };
}

export function resetDemoRouteState(): void {
  resetEquipmentMonitor();
  resetDemoSessionData();
}

export async function POST(request: Request) {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const body = parsed as {
      run_id?: unknown;
      case_id?: unknown;
      joiner_id?: unknown;
      decision?: unknown;
      action?: unknown;
      start_date?: unknown;
      candidate_id?: unknown;
      request_id?: unknown;
      draft_id?: unknown;
      subject?: unknown;
      body?: unknown;
      response?: unknown;
      question?: unknown;
      eta?: unknown;
      status?: unknown;
  };
  if ("decision" in body && (typeof body.run_id !== "string" || !body.run_id
    || typeof body.case_id !== "string" || !body.case_id)) {
    return NextResponse.json({ error: "A current case and run are required for an approval decision." }, { status: 409 });
  }
  if (body.action === "reset") {
    resetEquipmentMonitor();
    resetDemoState();
    resetDemoSessionData();
    return NextResponse.json({ reset: true });
  }
  const mutationToken = beginDemoMutation();
  if (!mutationToken) {
    return NextResponse.json({ error: "Another demo mutation is in progress. Retry with the current run." }, { status: 409 });
  }
  try {
    if (body.action === "open_case") {
      if (!supportedJoiner(body.joiner_id)) {
        return NextResponse.json({ error: "This demo supports Aisha Okafor and Priya Raman only." }, { status: 400 });
      }
      const { run } = await openDemoCase(body.joiner_id, mutationToken);
      return NextResponse.json(preparationResponse(run));
    }
    if (body.action === "ask" && typeof body.run_id !== "string") {
      const parsed = readAskQuestion(body.question);
      if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
      // An entry question with no active case opens the case exactly as "Simulate contract
      // signed" does: the assistant runs, proposals land in the approval queue. The answer says so,
      // because "read-only" is only true once a case is open.
      const joinerId = supportedJoiner(body.joiner_id) ? body.joiner_id : "J-004";
      const { run: preparation, opened } = await openDemoCase(joinerId, mutationToken);
      const answer = alignAskStatusNextAction(
        await askCase(preparation.case, preparation.joiner, parsed.question, process.env.DEMO_MODE === "live" ? "live" : "mock"),
        preparation,
        parsed.question,
      );
      if (opened) {
        const agent = preparation.agent;
        const proposals = agent?.proposals.length ?? 0;
        const broadQuestion = askIntentFor(parsed.question) === "status";
        const opening = broadQuestion ? `Opened ${preparation.case.id} for ${preparation.joiner.full_name} and ran the readiness checks: ${proposals} proposal${proposals === 1 ? "" : "s"} now await approval.` : `Opened ${preparation.joiner.full_name}’s onboarding case.`;
        answer.answer = `${opening} ${answer.answer}`;
        answer.links = [...new Set([...answer.links, "activity" as const])];
      }
      preparation.trace.push({ actor: answer.provider === "system" ? "system" : "agent", kind: "agent.asked", summary: `Ask Athena answered: ${answer.answer}` });
      saveRun(preparation, mutationToken);
      return NextResponse.json({ ...preparationResponse(preparation), answer });
    }
    if (body.action && typeof body.run_id !== "string") {
      return NextResponse.json({ error: "A current run is required for this demo mutation." }, { status: 409 });
    }
    if (typeof body.run_id === "string") {
      const preparation = currentRun(body);
      if (!preparation) {
        return NextResponse.json({ error: "This approval run is no longer active. Start a new run." }, { status: 409 });
      }
      if (body.action === "ask") {
        const parsed = readAskQuestion(body.question);
        if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
        const answer = alignAskStatusNextAction(
          await askCase(preparation.case, preparation.joiner, parsed.question, process.env.DEMO_MODE === "live" ? "live" : "mock"),
          preparation,
          parsed.question,
        );
        preparation.trace.push({ actor: answer.provider === "system" ? "system" : "agent", kind: "agent.asked", summary: `Ask Athena answered: ${answer.answer}` });
        return NextResponse.json({ ...preparationResponse(preparation), answer });
      }
      if (body.action === "start_date_change") {
        if (typeof body.start_date !== "string") {
          return NextResponse.json({ error: "start_date is required for a start-date change" }, { status: 400 });
        }
        const updated = await changeDemoStartDate(preparation, body.start_date);
        saveRun(updated, mutationToken);
        return NextResponse.json(preparationResponse(updated));
      }
      if (body.action === "retry_agent") {
        const updated = await retryAgent(preparation);
        saveRun(updated, mutationToken);
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "equipment_supplier_update") {
        const update = findAction("equipment.update_order");
        if (!update) return NextResponse.json({ error: "Equipment supplier update is unavailable." }, { status: 500 });
        const sourceUpdate = await update.action.run({ joiner_id: preparation.joiner.id, eta: body.eta, status: body.status, now: new Date().toISOString() });
        if (sourceUpdate.status === "error" || sourceUpdate.status === "denied") {
          return NextResponse.json({ error: sourceUpdate.summary }, { status: 400 });
        }
        return NextResponse.json({ ...preparationResponse(preparation), source_update: sourceUpdate });
      }

      if (body.action === "access_request") {
        const updated = await requestDemoAccess(preparation);
        saveRun(updated, mutationToken);
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "manager_prepare") {
        const updated = await prepareManagerCoordination(preparation);
        saveRun(updated, mutationToken);
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "manager_edit") {
        const updated = await editDemoManagerDraft(preparation, body.request_id, body.draft_id, body.subject, body.body, "pp-1");
        saveRun(updated, mutationToken);
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "manager_decision") {
        if (body.decision !== "approve" && body.decision !== "reject") {
          return NextResponse.json({ error: "decision must be approve or reject" }, { status: 400 });
        }
        const updated = await resolveManagerApproval(preparation, body.request_id, body.draft_id, body.decision as DemoDecision, "pp-1");
        saveRun(updated, mutationToken);
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "manager_response") {
        const updated = recordManagerResponse(preparation, body.request_id, {
          arrival_time: "09:30",
          meeting_place: `${preparation.joiner.office} office reception`,
          first_day_outline: ["Meet the manager", "Team introductions", "Role priorities and first-week plan"],
          items_to_bring: ["Photo ID", "Laptop charger"],
        });
        saveRun(updated, mutationToken);
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "manager_confirm") {
        const updated = confirmManagerPlan(preparation, body.request_id, "pp-1");
        saveRun(updated, mutationToken);
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "edit_equipment_draft") {
        const updated = await editDemoEquipmentDraft(preparation, body.draft_id, body.subject, body.body, "pp-1");
        saveRun(updated, mutationToken);
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "buddy_availability_change") {
        if (typeof body.candidate_id !== "string") {
          return NextResponse.json({ error: "candidate_id is required for a simulated availability change" }, { status: 400 });
        }
        const updated = await simulateBuddyAvailabilityChange(preparation, body.candidate_id);
        saveRun(updated, mutationToken);
        return NextResponse.json(preparationResponse(updated));
      }

      if (body.action === "buddy_prepare") {
        const updated = await prepareBuddyRequest(preparation, typeof body.candidate_id === "string" ? body.candidate_id : undefined);
        saveRun(updated, mutationToken);
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
        saveRun(result.preparation, mutationToken);
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
        saveRun(result.preparation, mutationToken);
        return NextResponse.json(preparationResponse(result.preparation));
      }

      if (body.action === "buddy_confirm") {
        if (typeof body.request_id !== "string") {
          return NextResponse.json({ error: "request_id is required for People confirmation" }, { status: 400 });
        }
        const result = await confirmBuddy(preparation, body.request_id, "pp-1");
        saveRun(result.preparation, mutationToken);
        if (result.conflict) {
          return NextResponse.json({ error: result.conflict, ...preparationResponse(result.preparation) }, { status: 409 });
        }
        return NextResponse.json(preparationResponse(result.preparation));
      }

      if (body.action !== undefined) {
        return NextResponse.json({ error: `Unknown demo action: ${String(body.action)}` }, { status: 400 });
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
      saveRun(updated, mutationToken);
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

    const joinerId = supportedJoiner(body.joiner_id) ? body.joiner_id : "J-004";
    const { run: preparation } = await openDemoCase(joinerId, mutationToken);
    return NextResponse.json(preparationResponse(preparation));
  } catch (error) {
    if (error instanceof StaleDemoMutationError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof EquipmentApprovalConflict) {
      try {
        saveRun(error.preparation, mutationToken);
      } catch (saveError) {
        if (saveError instanceof StaleDemoMutationError) {
          return NextResponse.json({ error: saveError.message }, { status: 409 });
        }
        throw saveError;
      }
      return NextResponse.json({ error: error.message, recovery: "equipment_reassessment", ...preparationResponse(error.preparation) }, { status: error.statusCode });
    }
    if (error instanceof BuddyFlowConflict || error instanceof DemoInputError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Demo flow failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    endDemoMutation(mutationToken);
  }
}

export async function GET(request: Request) {
  const requestedCaseId = new URL(request.url).searchParams.get("case_id");
  const runs = listDemoRuns().filter((run) => !requestedCaseId || run.case.id === requestedCaseId);
  return NextResponse.json({
    busy: demoMutationInFlight(),
    monitor: equipmentMonitor.snapshot(),
    cases: runs.map(preparationResponse),
  });
}
