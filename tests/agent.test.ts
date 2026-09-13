import { beforeEach, describe, expect, it } from "vitest";
import { prepareDemo } from "@/lib/demo-flow";
import { runAgent } from "@/lib/agent/loop";
import { validateMessageProposal } from "@/lib/agent/guards";
import { resetDemoState } from "@/lib/store/demo-state";
import { orders } from "@/lib/connectors/simulated/equipment";
import type { AgentModel } from "@/lib/agent/types";

beforeEach(() => {
  resetDemoState();
});

describe("bounded agent loop", () => {
  it("reaches J-004 terminal state with pending equipment and buddy proposals", async () => {
    const preparation = await prepareDemo(undefined, "mock");

    expect(preparation.agent?.stop_reason).toBe("finished");
    expect(preparation.agent?.provider).toBe("mock");
    expect(preparation.agent?.tool_calls).toBeLessThanOrEqual(12);
    expect(preparation.agent?.model_steps).toBeLessThanOrEqual(8);
    expect(preparation.agent?.refused).toBe(1);
    expect(preparation.agent?.next_action).toBe("Approve the equipment nudge to Nadia Hussain and the buddy request to Ewan Grant.");
    expect(preparation.draft?.status).toBe("pending");
    expect(preparation.buddy.request?.status).toBe("pending_approval");
    expect(preparation.buddy.draft?.status).toBe("pending");
    expect(preparation.beforeApproval?.status).toBe("denied");
    expect(preparation.buddy.beforeApproval?.status).toBe("denied");
    expect(orders).toHaveLength(1);
    expect(preparation.agent?.trace.some((entry) => entry.kind === "agent.guard.refused")).toBe(true);
    expect(preparation.agent?.trace.some((entry) => entry.kind === "agent.guard.refused" && entry.summary.includes("identity.grant_access"))).toBe(true);
    expect(preparation.agent?.stop_reason).toBe("finished");
    expect(preparation.case.steps.some((step) => step.kind === "guard.refused")).toBe(true);
  });

  it("stops at model step cap without committing staged state", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const draftsBefore = preparation.case.drafts.length;
    const model: AgentModel = {
      provider: "mock",
      model: "step-cap-test-model",
      async complete() {
        return { content: [{ type: "tool_use" as const, id: "repeat-state", name: "get_case_state", input: {} }] };
      },
    };

    const stopped = await runAgent(preparation.case, preparation.joiner, "availability_changed", "2026-09-30T09:00:00Z", "mock", { model });

    expect(stopped.stop_reason).toBe("step_cap");
    expect(stopped.next_action).toContain("Run assistant again");
    expect(preparation.case.drafts).toHaveLength(draftsBefore);
  });

  it("rejects invented dates and recipients outside deterministic allowlists", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const equipmentTask = preparation.case.tasks.find((task) => task.type === "equipment_order")!;
    const context = {
      case: preparation.case,
      joiner: preparation.joiner,
      equipmentTask,
      equipmentEta: preparation.facts.equipment_eta,
      availability: preparation.agent?.availability ?? null,
      allowed_dates: new Set([preparation.facts.start_date, preparation.facts.equipment_eta]),
    };

    const inventedDate = validateMessageProposal({
      kind: "nudge",
      to: equipmentTask.owner_id,
      subject: "Laptop plan",
      body: "Please arrange a loaner or earlier delivery by 2026-11-01.",
      reason: "Test",
      evidence: [],
    }, context);
    const outsideRecipient = validateMessageProposal({
      kind: "nudge",
      to: "attacker",
      subject: "Laptop plan",
      body: "Please arrange a loaner or earlier delivery.",
      reason: "Test",
      evidence: [],
    }, context);

    expect(inventedDate.ok).toBe(false);
    expect(outsideRecipient.ok).toBe(false);
  });

  it("returns same run for same trigger and input state", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const repeated = await runAgent(preparation.case, preparation.joiner, "contract.signed", "2026-09-30T09:00:00Z", "mock");

    expect(repeated.run_id).toBe(preparation.agent?.run_id);
    expect(repeated.input_state_hash).toBe(preparation.agent?.input_state_hash);
    expect(preparation.case.drafts.filter((draft) => draft.status === "pending")).toHaveLength(2);
  });
});

describe("live-model tolerance without weakening the boundary", () => {
  it("accepts every written form of a date that is in the facts, and still refuses one that is not", async () => {
    const { inventedDate } = await import("@/lib/agent/guards");
    const allowed = new Set(["2026-10-12", "2026-10-16", "2026-10-06"]);
    for (const body of ["due 12 October", "due 12 Oct", "due October 12", "due 12th October", "due 2026-10-12", "due 12/10/2026", "ETA 16 October, start 12 October"]) {
      expect(inventedDate(body, allowed), body).toBeNull();
    }
    expect(inventedDate("due 13 October", allowed)).toBe("13 October");
    expect(inventedDate("due 2026-10-13", allowed)).toBe("2026-10-13");
  });
});

describe("text-only model turns", () => {
  it("reminds once, then closes as an implicit finish when something was proposed or escalated", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    let turn = 0;
    const model: AgentModel = {
      provider: "mock",
      model: "text-then-tool",
      async complete(messages) {
        turn += 1;
        const seen = new Set(messages.flatMap((m) => Array.isArray(m.content) ? m.content.flatMap((b) => b.type === "tool_result" ? [b.name] : []) : []));
        if (!seen.has("get_case_state")) return { content: [{ type: "tool_use" as const, id: "t1", name: "get_case_state", input: {} }] };
        if (!seen.has("escalate")) return { content: [{ type: "tool_use" as const, id: "t2", name: "escalate", input: { code: "OWNER_SLA_BREACHED", summary: "Equipment owner is late against SLA.", evidence: ["EQ-0001"] } }] };
        return { content: [{ type: "text" as const, text: "Chase the equipment owner." }] };
      },
    };

    const run = await runAgent(preparation.case, preparation.joiner, "availability_changed", "2026-09-30T09:00:00Z", "mock", { model });

    expect(run.stop_reason).toBe("finished");
    expect(run.next_action).toBe("Chase the equipment owner.");
    expect(run.trace.some((entry) => entry.kind === "agent.reminded")).toBe(true);
    expect(run.trace.some((entry) => entry.kind === "agent.implicit_finish")).toBe(true);
    expect(turn).toBe(4);
  });

  it("treats a text-only turn with nothing proposed as a model error", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const model: AgentModel = {
      provider: "mock",
      model: "text-only",
      async complete() {
        return { content: [{ type: "text" as const, text: "All good." }] };
      },
    };
    const run = await runAgent(preparation.case, preparation.joiner, "availability_changed", "2026-09-30T09:00:00Z", "mock", { model });
    expect(run.stop_reason).toBe("model_error");
  });
});
