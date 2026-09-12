import { NextResponse } from "next/server";
import { personById } from "@/data/people";
import {
  changeDemoStartDate,
  prepareDemo,
  resolveDemoApproval,
  type DemoDecision,
  type DemoPreparation,
} from "@/lib/demo-flow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let activeRun: DemoPreparation | null = null;

function caseSummary(run: DemoPreparation) {
  return {
    id: run.case.id,
    state: run.case.state,
    start_date: run.case.start_date,
    task_count: run.case.tasks.length,
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

function preparationResponse(run: DemoPreparation) {
  return {
    phase: "pending" as const,
    screen_state: run.draft ? "awaiting_decision" as const : "no_action" as const,
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
    facts: run.facts,
    draft: draftSummary(run),
    before_approval: run.beforeApproval,
    date_change: run.date_change,
    trace: run.trace,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { run_id?: unknown; decision?: unknown; action?: unknown; start_date?: unknown };
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
      if (body.decision !== "approve" && body.decision !== "reject") {
        return NextResponse.json({ error: "decision must be approve or reject" }, { status: 400 });
      }
      if (!preparation.draft) {
        return NextResponse.json({ error: "There is no current draft requiring approval" }, { status: 409 });
      }
      activeRun = null;
      const resolution = await resolveDemoApproval(preparation, body.decision as DemoDecision, "pp-1");
      return NextResponse.json({
        ...preparationResponse(preparation),
        phase: "resolved" as const,
        screen_state: "resolved" as const,
        decision: resolution.decision,
        draft: {
          ...draftSummary(preparation),
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
    const message = error instanceof Error ? error.message : "Demo flow failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
