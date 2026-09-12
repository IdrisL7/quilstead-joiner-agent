import { describe, expect, it } from "vitest";
import { changeDemoStartDate, prepareDemo, resolveDemoApproval, runDemo } from "@/lib/demo-flow";

describe("single end-to-end demonstration", () => {
  it("runs event to plan to approved send with a trace", async () => {
    const run = await runDemo();

    expect(run.case.id).toBe("CASE-J-004");
    expect(run.equipment.status).toBe("warning");
    expect(run.draft.status).toBe("approved");
    expect(run.draft.body).toContain("loaner or earlier delivery");
    expect(run.beforeApproval.status).toBe("denied");
    expect(run.approved).toBe(true);
    expect(run.afterApproval.status).toBe("ok");
    expect(run.retry.summary).toContain("duplicate suppressed");
    expect(run.trace.map((step) => step.kind)).toEqual(expect.arrayContaining([
      "event.received",
      "plan.built",
      "tool.equipment.order",
      "draft.created",
      "send.refused",
      "draft.approved",
      "send.completed",
      "send.retried",
    ]));
  });

  it("pauses for a real reject decision and never sends", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    expect(preparation.draft?.status).toBe("pending");

    const resolution = await resolveDemoApproval(preparation, "reject", "pp-1");

    expect(resolution.draft.status).toBe("rejected");
    expect(resolution.afterApproval.status).toBe("denied");
    expect(resolution.trace.at(-2)?.kind).toBe("draft.rejected");
    expect(resolution.trace.at(-1)?.kind).toBe("send.refused");
  });

  it("rejects a decision from a superseded preparation", async () => {
    const oldPreparation = await prepareDemo(undefined, "mock");
    const currentPreparation = await prepareDemo(undefined, "mock");

    expect(currentPreparation.run_id).not.toBe(oldPreparation.run_id);
    expect(currentPreparation.draft?.id).not.toBe(oldPreparation.draft?.id);
    await expect(resolveDemoApproval(oldPreparation, "approve", "pp-1")).rejects.toThrow("could not be recorded");
    expect(currentPreparation.draft?.status).toBe("pending");

    const resolution = await resolveDemoApproval(currentPreparation, "approve", "pp-1");
    expect(resolution.afterApproval.status).toBe("ok");
  });

  it("projects current evidence and recalculates the same case after a start-date change", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const oldDraftId = preparation.draft?.id;

    expect(preparation.facts.start_date).toBe("2026-10-12");
    expect(preparation.facts.equipment_eta).toBe("2026-10-16");
    expect(preparation.facts.gap_days).toBe(4);
    expect(preparation.facts.equipment_late).toBe(true);
    expect(preparation.facts.equipment_owner_name).toBe("Nadia Hussain");
    expect(preparation.facts.policy_quote).toContain("five working days");

    const updated = await changeDemoStartDate(preparation, "2026-10-19", "mock");

    expect(updated.run_id).not.toBe(preparation.run_id);
    expect(updated.case.id).toBe(preparation.case.id);
    expect(updated.joiner.start_date).toBe("2026-10-19");
    expect(updated.facts.equipment_late).toBe(false);
    expect(updated.facts.gap_days).toBe(-3);
    expect(updated.draft).toBeNull();
    expect(updated.date_change).toMatchObject({
      previous_start_date: "2026-10-12",
      new_start_date: "2026-10-19",
      risk_before: true,
      risk_after: false,
    });
    expect(updated.date_change?.deadlines_changed).toBeGreaterThan(0);
    expect(updated.case.drafts.find((draft) => draft.id === oldDraftId)?.status).toBe("rejected");
    await expect(resolveDemoApproval(preparation, "approve", "pp-1")).rejects.toThrow("could not be recorded");

    const riskReturned = await changeDemoStartDate(updated, "2026-10-09", "mock");
    expect(riskReturned.case.id).toBe("CASE-J-004");
    expect(riskReturned.facts.equipment_late).toBe(true);
    expect(riskReturned.draft?.id).toBeDefined();
    expect(riskReturned.draft?.id).not.toBe(oldDraftId);
  });

  it("keeps the updated case recoverable when regeneration fails", async () => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const preparation = await prepareDemo(undefined, "mock");
      const failed = await changeDemoStartDate(preparation, "2026-10-09", "live");

      expect(failed.case.start_date).toBe("2026-10-09");
      expect(failed.joiner.start_date).toBe("2026-10-09");
      expect(failed.facts.start_date).toBe("2026-10-09");
      expect(failed.facts.equipment_late).toBe(true);
      expect(failed.draft).toBeNull();
      expect(failed.draft_unavailable?.message).toContain("case and dates are current");
      expect(failed.trace.at(-1)?.kind).toBe("draft.unavailable");
      expect(failed.case.drafts[0]?.status).toBe("rejected");
      await expect(resolveDemoApproval(failed, "approve", "pp-1")).rejects.toThrow("no current draft");

      const retriedSameDate = await changeDemoStartDate(failed, "2026-10-09", "mock");
      expect(retriedSameDate.case.id).toBe("CASE-J-004");
      expect(retriedSameDate.facts.start_date).toBe("2026-10-09");
      expect(retriedSameDate.draft?.status).toBe("pending");
      expect(retriedSameDate.draft_unavailable).toBeUndefined();

      const changedAgain = await changeDemoStartDate(failed, "2026-10-19", "mock");
      expect(changedAgain.facts.equipment_late).toBe(false);
      expect(changedAgain.draft).toBeNull();
      expect(changedAgain.draft_unavailable).toBeUndefined();
    } finally {
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  });
});
