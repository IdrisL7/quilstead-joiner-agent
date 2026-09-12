import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/demo/route";

function request(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("demo approval route", () => {
  it("rejects an approval from a superseded run", async () => {
    const oldResponse = await POST(request());
    const oldRun = await oldResponse.json() as { run_id: string };
    const currentResponse = await POST(request());
    const currentRun = await currentResponse.json() as { run_id: string };

    expect(currentRun.run_id).not.toBe(oldRun.run_id);

    const staleDecision = await POST(request({ run_id: oldRun.run_id, decision: "approve" }));
    expect(staleDecision.status).toBe(409);

    const currentDecision = await POST(request({ run_id: currentRun.run_id, decision: "approve" }));
    expect(currentDecision.status).toBe(200);
    expect((await currentDecision.json()).after_approval.status).toBe("ok");
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
      const retryResponse = await POST(request({ run_id: failed.run_id, action: "retry_draft" }));
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
    expect(initial.attention.buddy.status).toBe("Ready for review");
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
      buddy: { request: unknown };
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
    expect(edited.buddy.request).toBeNull();

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
