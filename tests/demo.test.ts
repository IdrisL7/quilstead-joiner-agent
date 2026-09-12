import { describe, expect, it } from "vitest";
import { prepareDemo, resolveDemoApproval, runDemo } from "@/lib/demo-flow";

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
    expect(preparation.draft.status).toBe("pending");

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
    expect(currentPreparation.draft.id).not.toBe(oldPreparation.draft.id);
    await expect(resolveDemoApproval(oldPreparation, "approve", "pp-1")).rejects.toThrow("could not be recorded");
    expect(currentPreparation.draft.status).toBe("pending");

    const resolution = await resolveDemoApproval(currentPreparation, "approve", "pp-1");
    expect(resolution.afterApproval.status).toBe("ok");
  });
});
