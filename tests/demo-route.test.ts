import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST, resetDemoRouteState } from "@/app/api/demo/route";
import { resetDemoState } from "@/lib/store/demo-state";
import { findAction } from "@/lib/connectors/registry";
import { failed } from "@/lib/connectors/interface";
import { orders } from "@/lib/connectors/simulated/equipment";
import { sent } from "@/lib/connectors/simulated/messaging";

beforeEach(() => {
  resetDemoState();
  resetDemoRouteState();
  process.env.DEMO_MODE = "mock";
});

function request(body: Record<string, unknown> = {}) {
  const payload = typeof body.run_id === "string" && body.case_id === undefined
    ? { ...body, case_id: "CASE-J-004" }
    : body;
  return new Request("http://localhost/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("demo approval route", () => {
  it.each([
    { case_id: "CASE-J-001", decision: "approve" },
    { case_id: "CASE-J-001", run_id: null, decision: "reject" },
    { case_id: "CASE-J-001", run_id: "", decision: "approve" },
    { case_id: "CASE-J-001", run_id: 123, decision: "approve" },
    { run_id: "RUN-unknown", decision: "approve" },
    { case_id: "", run_id: "RUN-unknown", decision: "approve" },
  ])("rejects malformed decision identity without opening a case: %j", async (body) => {
    const response = await POST(new Request("http://localhost/api/demo", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(409);
    const snapshot = await (await GET(new Request("http://localhost/api/demo"))).json();
    expect(snapshot.cases).toEqual([]);
    expect(snapshot.monitor.running).toBe(false);
    expect(snapshot.monitor.agent_invocations).toBe(0);
    expect(orders).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it.each(["returned_error", "thrown_error", "lost_acknowledgement"] as const)("resumes a partially opened case after %s without duplicating its equipment order", async (failureMode) => {
    const equipment = findAction("equipment.order");
    if (!equipment) throw new Error("Equipment connector missing");
    const originalRun = equipment.action.run;
    const aisha = await (await POST(request())).json() as { run_id: string; case: { id: string } };
    let failedOnce = false;
    equipment.action.run = async (args) => {
      if (args.joiner_id !== "J-001" || failedOnce) return originalRun(args);
      failedOnce = true;
      if (failureMode === "returned_error") return failed("Temporary equipment failure", true);
      if (failureMode === "thrown_error") throw new Error("Temporary equipment failure");
      await originalRun(args);
      throw new Error("Timeout after equipment order");
    };
    try {
      const failedOpen = await POST(request({ action: "open_case", joiner_id: "J-001" }));
      expect(failedOpen.status).toBe(500);

      equipment.action.run = originalRun;
      const recoveredResponse = await POST(request({ action: "open_case", joiner_id: "J-001" }));
      expect(recoveredResponse.status).toBe(200);
      const recovered = await recoveredResponse.json() as { case: { id: string }; joiner: { id: string }; equipment: { summary: string } };
      expect(recovered.case.id).toBe("CASE-J-001");
      expect(recovered.joiner.id).toBe("J-001");
      expect(recovered.equipment.summary).not.toContain("duplicate");
      expect(orders.filter((order) => order.joiner_id === "J-001")).toHaveLength(1);

      const preserved = await (await POST(request({ action: "open_case", joiner_id: "J-004" }))).json() as typeof aisha;
      expect(preserved.run_id).toBe(aisha.run_id);
    } finally {
      equipment.action.run = originalRun;
    }
  });

  it("keeps Aisha and Priya state isolated while switching cases", async () => {
    const aisha = await (await POST(request())).json() as {
      run_id: string; case: { id: string }; draft: { id: string }; decision?: string;
    };
    const approvedAishaResponse = await POST(request({
      case_id: aisha.case.id,
      run_id: aisha.run_id,
      decision: "approve",
    }));
    expect(approvedAishaResponse.status).toBe(200);
    const approvedAisha = await approvedAishaResponse.json() as typeof aisha & { decision: string };
    expect(approvedAisha.decision).toBe("approve");

    const priyaResponse = await POST(request({ action: "open_case", joiner_id: "J-001" }));
    expect(priyaResponse.status).toBe(200);
    const priya = await priyaResponse.json() as {
      run_id: string; case: { id: string; start_date: string }; joiner: { id: string; full_name: string };
    };
    expect(priya.joiner).toMatchObject({ id: "J-001", full_name: "Priya Raman" });
    expect(priya.case.id).toBe("CASE-J-001");

    const wrongCase = await POST(request({ case_id: priya.case.id, run_id: approvedAisha.run_id, decision: "approve" }));
    expect(wrongCase.status).toBe(409);

    const changedPriyaResponse = await POST(request({
      case_id: priya.case.id,
      run_id: priya.run_id,
      action: "start_date_change",
      start_date: "2026-10-09",
    }));
    expect(changedPriyaResponse.status).toBe(200);
    const changedPriya = await changedPriyaResponse.json() as typeof priya;
    expect(changedPriya.case.start_date).toBe("2026-10-09");

    const reopenedAisha = await (await POST(request({ action: "open_case", joiner_id: "J-004" }))).json() as typeof approvedAisha;
    expect(reopenedAisha.run_id).toBe(approvedAisha.run_id);
    expect(reopenedAisha.decision).toBe("approve");

    const reopenedPriya = await (await POST(request({ action: "open_case", joiner_id: "J-001" }))).json() as typeof priya;
    expect(reopenedPriya.run_id).toBe(changedPriya.run_id);
    expect(reopenedPriya.case.start_date).toBe("2026-10-09");
  });

  it("rejects an approval from a superseded run", async () => {
    const oldResponse = await POST(request());
    const oldRun = await oldResponse.json() as { run_id: string; agent: { trigger: string; stop_reason: string; tool_calls: number; refused: number } };
    expect(oldRun.agent).toMatchObject({ trigger: "contract.signed", stop_reason: "finished", tool_calls: 9, refused: 1 });
    await POST(request({ action: "reset" }));
    const currentResponse = await POST(request());
    const currentRun = await currentResponse.json() as { run_id: string };

    expect(currentRun.run_id).not.toBe(oldRun.run_id);

    const staleDecision = await POST(request({ run_id: oldRun.run_id, decision: "approve" }));
    expect(staleDecision.status).toBe(409);

    const currentDecision = await POST(request({ run_id: currentRun.run_id, decision: "approve" }));
    expect(currentDecision.status).toBe(200);
    expect((await currentDecision.json()).after_approval.status).toBe("ok");
  });

  it("returns current facts and a recovery action when supplier evidence changes before approval", async () => {
    const pending = await (await POST(request())).json() as { run_id: string; case: { id: string }; draft: { id: string } };
    const supplierUpdate = findAction("equipment.update_order");
    if (!supplierUpdate) throw new Error("Equipment update connector missing");
    await supplierUpdate.action.run({ joiner_id: "J-004", eta: "2026-10-19", status: "backordered", now: "2026-09-30T10:00:00Z" });

    const refused = await POST(request({ case_id: pending.case.id, run_id: pending.run_id, decision: "approve" }));
    expect(refused.status).toBe(409);
    const recovery = await refused.json() as { error: string; recovery: string; run_id: string; screen_state: string; facts: { equipment_eta: string; equipment_late: boolean }; draft: null; draft_unavailable: { message: string } };
    expect(recovery.error).toContain("stale");
    expect(recovery.recovery).toBe("equipment_reassessment");
    expect(recovery.run_id).not.toBe(pending.run_id);
    expect(recovery.screen_state).toBe("draft_unavailable");
    expect(recovery.facts).toMatchObject({ equipment_eta: "2026-10-19", equipment_late: true });
    expect(recovery.draft).toBeNull();
    expect(recovery.draft_unavailable.message).toContain("not approved or sent");

    const retried = await POST(request({ case_id: pending.case.id, run_id: recovery.run_id, action: "retry_agent" }));
    expect(retried.status).toBe(200);
    const refreshed = await retried.json() as { draft: { id: string; status: string }; agent: { trigger: string } };
    expect(refreshed.agent.trigger).toBe("equipment_changed");
    expect(refreshed.draft).toMatchObject({ status: "pending" });
    expect(refreshed.draft.id).not.toBe(pending.draft.id);
    expect(sent).toHaveLength(0);
  });

  it("thins internal agent calls from the Activity trace while keeping decisions", async () => {
    const response = await POST(request());
    const run = await response.json() as {
      trace: Array<{ kind: string }>;
    };

    expect(run.trace.some((entry) => entry.kind === "agent.tool_call")).toBe(false);
    expect(run.trace.length).toBeLessThanOrEqual(12);
    expect(run.trace.some((entry) => entry.kind === "draft.created")).toBe(false);
    expect(run.trace.some((entry) => entry.kind === "buddy.request.prepared")).toBe(false);
    expect(run.trace.some((entry) => entry.kind === "agent.guard.refused")).toBe(true);
    expect(run.trace.some((entry) => entry.kind === "agent.proposed")).toBe(true);
    expect(run.trace.some((entry) => entry.kind === "agent.finished")).toBe(true);
  });

  it("projects only known first-week busy intervals into the UI summary", async () => {
    const initialResponse = await POST(request());
    const initial = await initialResponse.json() as {
      run_id: string;
      buddy: {
        availability: {
          candidates: Array<{
            candidate: { id: string };
            availability: {
              status: string;
              busy_intervals: Array<{ start_at: string; end_at: string }>;
              working_hours: { start_local: string; end_local: string };
              coverage_start_date: string;
              coverage_end_date: string;
            };
          }>;
        };
      };
    };

    const ewan = initial.buddy.availability.candidates.find(({ candidate }) => candidate.id === "b-06")!;
    expect(ewan.availability.status).toBe("available");
    expect(ewan.availability.busy_intervals).toHaveLength(2);
    expect(ewan.availability.working_hours).toEqual({ start_local: "09:00", end_local: "17:30" });
    expect(ewan.availability.coverage_start_date).toBe("2026-10-09");
    expect(ewan.availability.coverage_end_date).toBe("2026-10-23");

    const movedResponse = await POST(request({
      run_id: initial.run_id,
      action: "start_date_change",
      start_date: "2026-10-19",
    }));
    const moved = await movedResponse.json() as typeof initial;
    const movedEwan = moved.buddy.availability.candidates.find(({ candidate }) => candidate.id === "b-06")!;
    expect(movedEwan.availability.busy_intervals).toEqual([]);
  });

  it("recalculates the active case and invalidates the old approval run", async () => {
    const pendingResponse = await POST(request());
    const pending = await pendingResponse.json() as { run_id: string; draft: { id: string } };

    const changedResponse = await POST(request({
      run_id: pending.run_id,
      action: "start_date_change",
      start_date: "2026-10-19",
    }));
    expect(changedResponse.status).toBe(200);
    const changed = await changedResponse.json() as {
      run_id: string;
      screen_state: string;
      case: { id: string };
      facts: { equipment_late: boolean; gap_days: number };
      draft: unknown;
      date_change: { deadlines_changed: number; superseded_draft_id: string };
    };

    expect(changed.run_id).not.toBe(pending.run_id);
    expect(changed.case.id).toBe("CASE-J-004");
    expect(changed.screen_state).toBe("no_action");
    expect(changed.facts.equipment_late).toBe(false);
    expect(changed.facts.gap_days).toBe(-3);
    expect(changed.draft).toBeNull();
    expect(changed.date_change.superseded_draft_id).toBe(pending.draft.id);
    expect(changed.date_change.deadlines_changed).toBeGreaterThan(0);

    const staleDecision = await POST(request({ run_id: pending.run_id, decision: "approve" }));
    expect(staleDecision.status).toBe(409);
    const noDraftDecision = await POST(request({ run_id: changed.run_id, decision: "approve" }));
    expect(noDraftDecision.status).toBe(409);

    const riskResponse = await POST(request({
      run_id: changed.run_id,
      action: "start_date_change",
      start_date: "2026-10-09",
    }));
    expect(riskResponse.status).toBe(200);
    const risk = await riskResponse.json() as { screen_state: string; facts: { equipment_late: boolean }; draft: { status: string } | null };
    expect(risk.screen_state).toBe("awaiting_decision");
    expect(risk.facts.equipment_late).toBe(true);
    expect(risk.draft?.status).toBe("pending");
  });

  it("returns a recoverable current case when date-change drafting fails", async () => {
    const previousMode = process.env.DEMO_MODE;
    const previousKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.DEMO_MODE;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const pendingResponse = await POST(request());
      const pending = await pendingResponse.json() as { run_id: string };

      process.env.DEMO_MODE = "live";
      const failedResponse = await POST(request({
        run_id: pending.run_id,
        action: "start_date_change",
        start_date: "2026-10-09",
      }));
      expect(failedResponse.status).toBe(200);
      const failed = await failedResponse.json() as {
        run_id: string;
        screen_state: string;
        case: { start_date: string };
        joiner: { start_date: string };
        facts: { start_date: string; equipment_late: boolean };
        draft: unknown;
        draft_unavailable: { message: string };
      };

      expect(failed.run_id).not.toBe(pending.run_id);
      expect(failed.screen_state).toBe("draft_unavailable");
      expect(failed.case.start_date).toBe("2026-10-09");
      expect(failed.joiner.start_date).toBe("2026-10-09");
      expect(failed.facts.start_date).toBe("2026-10-09");
      expect(failed.facts.equipment_late).toBe(true);
      expect(failed.draft).toBeNull();
      expect(failed.draft_unavailable.message).toContain("retry drafting");

      process.env.DEMO_MODE = "mock";
      const retryResponse = await POST(request({ run_id: failed.run_id, action: "retry_agent" }));
      expect(retryResponse.status).toBe(200);
      const retried = await retryResponse.json() as { screen_state: string; facts: { start_date: string }; draft: { status: string } | null };
      expect(retried.screen_state).toBe("awaiting_decision");
      expect(retried.facts.start_date).toBe("2026-10-09");
      expect(retried.draft?.status).toBe("pending");
    } finally {
      if (previousMode === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = previousMode;
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  });

  it("projects current attention and refreshes the candidate recommendation after simulated availability changes", async () => {
    const initialResponse = await POST(request());
    expect(initialResponse.status).toBe(200);
    const initial = await initialResponse.json() as {
      run_id: string;
      attention: { equipment: { status: string }; buddy: { status: string }; compliance: { open_tasks: number; total_tasks: number } };
      buddy: { availability: { recommendation: { candidate_id: string } | null } };
    };

    expect(initial.attention.equipment.status).toBe("Needs approval");
    expect(initial.attention.buddy.status).toBe("Awaiting approval");
    expect(initial.attention.compliance.open_tasks).toBeGreaterThan(0);
    expect(initial.attention.compliance.total_tasks).toBeGreaterThanOrEqual(initial.attention.compliance.open_tasks);
    expect(initial.buddy.availability.recommendation?.candidate_id).toBe("b-06");

    const changedResponse = await POST(request({
      run_id: initial.run_id,
      action: "buddy_availability_change",
      candidate_id: "b-06",
    }));
    expect(changedResponse.status).toBe(200);
    const changed = await changedResponse.json() as {
      buddy: {
        availability: {
          recommendation: { candidate_id: string } | null;
          candidates: Array<{ candidate: { id: string }; availability: { status: string } }>;
        };
      };
      trace: Array<{ kind: string; summary: string }>;
    };

    expect(changed.buddy.availability.recommendation?.candidate_id).toBe("b-01");
    expect(changed.buddy.availability.candidates.find(({ candidate }) => candidate.id === "b-06")?.availability.status).toBe("unknown");
    expect(changed.trace.some((step) => step.kind === "simulation.buddy_calendar.changed")).toBe(true);
  });

  it("keeps compliance attention on the open compliance task after a date change", async () => {
    const initialResponse = await POST(request());
    const initial = await initialResponse.json() as { run_id: string };

    const changedResponse = await POST(request({
      run_id: initial.run_id,
      action: "start_date_change",
      start_date: "2026-10-19",
    }));
    expect(changedResponse.status).toBe(200);
    const changed = await changedResponse.json() as {
      attention: { compliance: { next_action: string; unresolved_escalations: number } };
    };

    expect(changed.attention.compliance.next_action).toContain("Right to work check evidenced in HRIS");
    expect(changed.attention.compliance.next_action).not.toContain("Start date moved");
    expect(changed.attention.compliance.unresolved_escalations).toBe(0);
  });

  it("saves a fresh equipment revision and rejects stale or post-send edits", async () => {
    const initialResponse = await POST(request());
    const initial = await initialResponse.json() as { run_id: string; draft: { id: string; body: string } };
    const editedResponse = await POST(request({
      run_id: initial.run_id,
      action: "edit_equipment_draft",
      draft_id: initial.draft.id,
      subject: "Equipment delivery needs a plan",
      body: "Please arrange a loaner or earlier delivery for Aisha before her first day.",
    }));
    expect(editedResponse.status).toBe(200);
    const edited = await editedResponse.json() as {
      run_id: string;
      draft: { id: string; body: string; status: string; edited_by: string; revision: number; supersedes_draft_id: string };
      before_approval: { status: string };
      buddy: { request: { status: string } | null };
    };

    expect(edited.run_id).not.toBe(initial.run_id);
    expect(edited.draft.id).not.toBe(initial.draft.id);
    expect(edited.draft).toMatchObject({
      body: "Please arrange a loaner or earlier delivery for Aisha before her first day.",
      status: "pending",
      edited_by: "pp-1",
      revision: 1,
      supersedes_draft_id: initial.draft.id,
    });
    expect(edited.before_approval.status).toBe("denied");
    expect(edited.buddy.request?.status).toBe("pending_approval");

    const staleApproval = await POST(request({ run_id: initial.run_id, decision: "approve" }));
    expect(staleApproval.status).toBe(409);
    const mismatchedDraft = await POST(request({
      run_id: edited.run_id,
      action: "edit_equipment_draft",
      draft_id: initial.draft.id,
      subject: "A different subject",
      body: "A different body",
    }));
    expect(mismatchedDraft.status).toBe(409);

    const approvedResponse = await POST(request({ run_id: edited.run_id, decision: "approve" }));
    expect(approvedResponse.status).toBe(200);
    const approved = await approvedResponse.json() as { run_id: string; draft: { id: string; status: string; body: string } };
    expect(approved.draft).toMatchObject({ id: edited.draft.id, status: "approved", body: edited.draft.body });

    const editAfterSend = await POST(request({
      run_id: approved.run_id,
      action: "edit_equipment_draft",
      draft_id: approved.draft.id,
      subject: "Too late",
      body: "This must not replace an approved message.",
    }));
    expect(editAfterSend.status).toBe(409);
  });

  it("keeps the current run and draft intact for invalid edit input", async () => {
    const initialResponse = await POST(request());
    const initial = await initialResponse.json() as { run_id: string; draft: { id: string } };
    const invalidBodies: Record<string, unknown>[] = [
      { subject: "", body: "Valid body" },
      { subject: "Valid subject", body: "" },
      { subject: 42, body: "Valid body" },
      { subject: "Valid subject", body: "x".repeat(701) },
    ];

    for (const fields of invalidBodies) {
      const response = await POST(request({
        run_id: initial.run_id,
        action: "edit_equipment_draft",
        draft_id: initial.draft.id,
        ...fields,
      }));
      expect(response.status).toBe(409);
    }

    const approval = await POST(request({ run_id: initial.run_id, decision: "approve" }));
    expect(approval.status).toBe(200);
  });

  it("rejects a stale save after date change or deliberate replay", async () => {
    const initialResponse = await POST(request());
    const initial = await initialResponse.json() as { run_id: string; draft: { id: string } };
    const changedResponse = await POST(request({ run_id: initial.run_id, action: "start_date_change", start_date: "2026-10-19" }));
    expect(changedResponse.status).toBe(200);
    const changed = await changedResponse.json() as { run_id: string; draft: null };
    expect(changed.draft).toBeNull();

    const staleAfterDateChange = await POST(request({
      run_id: initial.run_id,
      action: "edit_equipment_draft",
      draft_id: initial.draft.id,
      subject: "Stale subject",
      body: "Stale body",
    }));
    expect(staleAfterDateChange.status).toBe(409);

    await POST(request({ action: "reset" }));
    const replayResponse = await POST(request());
    const replay = await replayResponse.json() as { run_id: string; draft: { id: string } };
    const staleAfterReplay = await POST(request({
      run_id: changed.run_id,
      action: "edit_equipment_draft",
      draft_id: initial.draft.id,
      subject: "Another stale subject",
      body: "Another stale body",
    }));
    expect(staleAfterReplay.status).toBe(409);
    expect(replay.run_id).not.toBe(changed.run_id);
  });

  it("keeps an active buddy request usable after the equipment draft is edited", async () => {
    const initialResponse = await POST(request());
    const initial = await initialResponse.json() as { run_id: string; draft: { id: string } };
    const buddyResponse = await POST(request({ run_id: initial.run_id, action: "buddy_prepare", candidate_id: "b-06" }));
    expect(buddyResponse.status).toBe(200);
    const withBuddy = await buddyResponse.json() as {
      run_id: string;
      draft: { id: string };
      buddy: { request: { id: string; status: string }; draft: { id: string } };
    };
    const editedResponse = await POST(request({
      run_id: withBuddy.run_id,
      action: "edit_equipment_draft",
      draft_id: withBuddy.draft.id,
      subject: "Edited equipment subject",
      body: "Edited equipment body",
    }));
    expect(editedResponse.status).toBe(200);
    const edited = await editedResponse.json() as {
      run_id: string;
      buddy: { request: { id: string; status: string }; draft: { id: string } };
    };

    expect(edited.buddy.request).toMatchObject({ id: withBuddy.buddy.request.id, status: "pending_approval" });
    expect(edited.buddy.draft.id).toBe(withBuddy.buddy.draft.id);
    const buddyApproval = await POST(request({
      run_id: edited.run_id,
      action: "buddy_decision",
      request_id: edited.buddy.request.id,
      draft_id: edited.buddy.draft.id,
      decision: "approve",
    }));
    expect(buddyApproval.status).toBe(200);
    expect((await buddyApproval.json()).buddy.request.status).toBe("awaiting_acceptance");
  });
});

describe("demo route input validation and guidance", () => {
  async function fresh() {
    return await (await POST(request())).json() as { run_id: string; next_action: string | null; draft: { id: string } | null; buddy: { request: { id: string; candidate_id: string } | null; draft: { id: string } | null } };
  }

  it("answers bad input with 400, never 500", async () => {
    const run = await fresh();
    const cases: Array<[string, Request, string]> = [
      ["malformed JSON", new Request("http://localhost/api/demo", { method: "POST", body: "{not json" }), "JSON"],
      ["null body", new Request("http://localhost/api/demo", { method: "POST", body: "null" }), "object"],
      ["array body", new Request("http://localhost/api/demo", { method: "POST", body: "[]" }), "object"],
      ["unknown action", request({ run_id: run.run_id, action: "explode" }), "Unknown demo action"],
      ["same start date", request({ run_id: run.run_id, action: "start_date_change", start_date: "2026-10-12" }), "different start date"],
      ["impossible date", request({ run_id: run.run_id, action: "start_date_change", start_date: "2026-02-30" }), "not a real calendar date"],
      ["garbage date", request({ run_id: run.run_id, action: "start_date_change", start_date: "next monday" }), "ISO date"],
      ["Saturday", request({ run_id: run.run_id, action: "start_date_change", start_date: "2026-10-17" }), "Saturday"],
      ["before the case clock", request({ run_id: run.run_id, action: "start_date_change", start_date: "2020-01-06" }), "before the case clock"],
      ["retry without an unavailable run", request({ run_id: run.run_id, action: "retry_agent" }), "already finished"],
    ];
    for (const [label, req, fragment] of cases) {
      const response = await POST(req);
      const body = await response.json() as { error?: string };
      expect(response.status, label).toBe(400);
      expect(body.error ?? "", label).toContain(fragment);
    }
    // The case is untouched by any of the refused calls.
    const check = await POST(request({ run_id: run.run_id, action: "ask", question: "what's left before day one?" }));
    expect(check.status).toBe(200);
  });

  it("moves the next action past an approved nudge on every surface", async () => {
    const run = await fresh();
    expect(run.next_action).toContain("Approve or reject the equipment nudge to Nadia Hussain");
    expect(run.next_action).toContain("Approve or reject the exact buddy request to Ewan Grant");
    expect(run.next_action).toContain("Prepare the first-day plan request to Chloe Bennett");
    expect(run.next_action).toContain("Submit 6 remaining role access requests");
    const approved = await (await POST(request({ run_id: run.run_id, decision: "approve" }))).json() as { next_action: string; agent: { next_action: string } };
    expect(approved.agent.next_action).toContain("Approve the equipment nudge");
    expect(approved.next_action).not.toContain("Approve the equipment nudge");
    expect(approved.next_action).toContain("Wait for IT to arrange a loaner or earlier delivery");
    expect(approved.next_action).toContain("Approve or reject the exact buddy request");
  });

  it("describes a rejected nudge honestly instead of asking for a review", async () => {
    const run = await fresh();
    const rejected = await (await POST(request({ run_id: run.run_id, decision: "reject" }))).json() as { next_action: string; attention: { equipment: { status: string; next_action: string } } };
    expect(rejected.attention.equipment.status).toBe("Nudge rejected");
    expect(rejected.attention.equipment.next_action).toContain("Nothing was sent");
    expect(rejected.next_action).toContain("Nothing was sent");
  });

  it("keeps the pending equipment nudge in the banner after a buddy-only run", async () => {
    const run = await fresh();
    const approved = await (await POST(request({ run_id: run.run_id, action: "buddy_decision", request_id: run.buddy.request!.id, draft_id: run.buddy.draft!.id, decision: "approve" }))).json() as { run_id: string; buddy: { request: { id: string } } };
    const declined = await (await POST(request({ run_id: approved.run_id, action: "buddy_response", request_id: approved.buddy.request.id, response: "declined" }))).json() as { next_action: string; agent: { next_action: string } };
    expect(declined.agent.next_action).toBe("Approve the replacement buddy request to Amara Osei; Ewan Grant declined.");
    expect(declined.next_action).toContain("Approve or reject the equipment nudge to Nadia Hussain");
    expect(declined.next_action).toContain("Approve or reject the exact buddy request to Amara Osei");
    expect(declined.next_action).not.toContain("Ewan Grant still awaits approval");
  });

  it("does not duplicate trace rows when an idempotent agent run is re-applied", async () => {
    const run = await fresh();
    const first = await (await POST(request({ run_id: run.run_id, action: "buddy_availability_change", candidate_id: "b-03" }))).json() as { run_id: string; agent: { run_id: string }; trace: Array<{ kind: string }> };
    const second = await (await POST(request({ run_id: first.run_id, action: "buddy_availability_change", candidate_id: "b-03" }))).json() as { run_id: string; agent: { run_id: string }; trace: Array<{ kind: string }> };
    const proposed = (trace: Array<{ kind: string }>) => trace.filter((entry) => entry.kind === "agent.proposed").length;
    expect(second.agent.run_id).toBe(first.agent.run_id);
    expect(proposed(second.trace)).toBe(proposed(first.trace));
  });
});
