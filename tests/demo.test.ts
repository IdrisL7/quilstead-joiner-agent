import { describe, expect, it } from "vitest";
import { runDemo } from "@/lib/demo-flow";

describe("single end-to-end demonstration", () => {
  it("runs event to plan to approved send with a trace", async () => {
    const run = await runDemo();

    expect(run.case.id).toBe("CASE-J-004");
    expect(run.equipment.status).toBe("warning");
    expect(run.draft.status).toBe("approved");
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
});
