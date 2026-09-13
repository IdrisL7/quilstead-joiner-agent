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
    expect(preparation.draft?.status).toBe("pending");
    expect(preparation.buddy.request?.status).toBe("pending_approval");
    expect(preparation.buddy.draft?.status).toBe("pending");
    expect(preparation.beforeApproval?.status).toBe("denied");
    expect(preparation.buddy.beforeApproval?.status).toBe("denied");
    expect(orders).toHaveLength(1);
    expect(preparation.agent?.trace.some((entry) => entry.kind === "agent.guard.refused")).toBe(true);
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
