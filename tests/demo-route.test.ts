import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/demo/route";

function request(body: Record<string, string> = {}) {
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
});
