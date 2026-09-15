import { beforeEach, describe, expect, it } from "vitest";
import { findAction } from "@/lib/connectors/registry";
import { orders } from "@/lib/connectors/simulated/equipment";
import { sent } from "@/lib/connectors/simulated/messaging";
import {
  EquipmentApprovalConflict,
  prepareDemo,
  reassessDemoEquipment,
  resolveDemoApproval,
  retryAgent,
} from "@/lib/demo-flow";
import { resetDemoState } from "@/lib/store/demo-state";
import { createAgentToolRuntime } from "@/lib/agent/tools";

const NOW = "2026-09-30T10:00:00Z";

function action(name: string) {
  const resolved = findAction(name);
  if (!resolved) throw new Error(`${name} connector action missing`);
  return resolved.action;
}

async function update(joinerId: string, eta: string, status: "ordered" | "backordered", now = NOW) {
  return action("equipment.update_order").run({ joiner_id: joinerId, eta, status, now });
}

describe("safe equipment reassessment", () => {
  beforeEach(() => {
    resetDemoState();
    process.env.DEMO_MODE = "mock";
  });

  it("validates source updates, ignores identical observations and recognises A to B to A", async () => {
    const preparation = await prepareDemo(undefined, "mock", "J-001");
    expect((await update("J-002", "2026-10-09", "backordered")).status).toBe("error");
    expect((await update("J-004", "2026-10-09", "backordered")).status).toBe("error");
    expect((await action("equipment.update_order").run({ joiner_id: "J-001", eta: "2026-02-30", status: "ordered", now: NOW })).status).toBe("error");
    expect((await action("equipment.update_order").run({ joiner_id: "J-001", eta: "2026-10-09", status: "lost", now: NOW })).status).toBe("error");

    const initial = orders.find((order) => order.joiner_id === "J-001")!;
    const initialEta = initial.eta;
    const initialStatus = initial.status;
    const unchanged = await update("J-001", initialEta, initialStatus);
    expect(unchanged.data).toMatchObject({ changed: false, source_revision: 1 });

    const changed = await update("J-001", "2026-10-09", "backordered");
    const restored = await update("J-001", initialEta, initialStatus, "2026-09-30T10:01:00Z");
    expect(changed.data).toMatchObject({ changed: true, source_revision: 2 });
    expect(restored.data).toMatchObject({ changed: true, source_revision: 3 });
    expect(orders.filter((order) => order.joiner_id === "J-001")).toHaveLength(1);
    const reconciledReturn = await reassessDemoEquipment(preparation, "mock", "2026-09-30T10:02:00Z");
    expect(reconciledReturn.run_id).not.toBe(preparation.run_id);
    expect(reconciledReturn.equipment_observation).toMatchObject({ eta: initialEta, status: initialStatus, source_revision: 3 });
    expect(reconciledReturn.draft).toBeNull();
  });

  it("turns Priya's on-time order late once, deduplicates unchanged evidence and clears the risk", async () => {
    const initial = await prepareDemo(undefined, "mock", "J-001");
    const preserved = JSON.stringify({ buddy: initial.case.buddy_requests, manager: initial.case.manager_plans, access: initial.case.tasks.filter((task) => task.type === "access_request") });
    expect(initial.facts).toMatchObject({ start_date: "2026-10-05", equipment_eta: "2026-10-05", equipment_late: false });
    expect(initial.draft).toBeNull();

    await update("J-001", "2026-10-09", "backordered");
    const late = await reassessDemoEquipment(initial, "mock", NOW);
    expect(late.facts).toMatchObject({ equipment_eta: "2026-10-09", equipment_late: true, gap_days: 4 });
    expect(late.equipment_observation).toMatchObject({ source_revision: 2, eta: "2026-10-09" });
    expect(late.draft).toMatchObject({ status: "pending", to: "it-1", equipment_source_revision: 2 });
    expect(new Set(late.agent?.steps.map((step) => step.tool))).toEqual(new Set(["get_case_state", "check_equipment", "propose_message", "finish"]));
    expect(JSON.stringify({ buddy: late.case.buddy_requests, manager: late.case.manager_plans, access: late.case.tasks.filter((task) => task.type === "access_request") })).toBe(preserved);

    const same = await reassessDemoEquipment(late, "mock", "2026-09-30T10:01:00Z");
    expect(same.run_id).toBe(late.run_id);
    expect(same.draft?.id).toBe(late.draft?.id);
    expect(same.case.drafts.filter((draft) => draft.workstream === "equipment" && draft.status === "pending")).toHaveLength(1);

    await update("J-001", "2026-10-02", "ordered", "2026-09-30T10:02:00Z");
    const clear = await reassessDemoEquipment(same, "mock", "2026-09-30T10:02:00Z");
    expect(clear.facts).toMatchObject({ equipment_eta: "2026-10-02", equipment_late: false });
    expect(clear.draft).toBeNull();
    expect(clear.beforeApproval).toBeNull();
    expect(clear.case.drafts.find((draft) => draft.id === late.draft?.id)).toMatchObject({ status: "rejected", decided_by: "system" });
  });

  it("replaces a pending late draft for a different late observation but not for unchanged evidence", async () => {
    const initial = await prepareDemo(undefined, "mock", "J-004");
    const firstDraftId = initial.draft!.id;
    const unchanged = await reassessDemoEquipment(initial, "mock", NOW);
    expect(unchanged.draft?.id).toBe(firstDraftId);

    await update("J-004", "2026-10-19", "backordered");
    const changed = await reassessDemoEquipment(unchanged, "mock", NOW);
    expect(changed.draft?.id).not.toBe(firstDraftId);
    expect(changed.draft).toMatchObject({ status: "pending", equipment_source_revision: 2 });
    expect(changed.case.drafts.find((draft) => draft.id === firstDraftId)).toMatchObject({ status: "rejected", decided_by: "system" });
    expect(changed.case.drafts.filter((draft) => draft.workstream === "equipment" && draft.status === "pending")).toHaveLength(1);
  });

  it("refuses an equipment-change proposal to anyone except the current equipment owner", async () => {
    const preparation = await prepareDemo(undefined, "mock", "J-004");
    const workingCase = structuredClone(preparation.case);
    for (const draft of workingCase.drafts) if (draft.workstream === "equipment" && draft.status === "pending") draft.status = "rejected";
    const runtime = createAgentToolRuntime({ case: workingCase, joiner: preparation.joiner, trigger: "equipment_changed", now: NOW });
    expect((await runtime.dispatch("check_equipment", {})).status).toBe("warning");
    const refused = await runtime.dispatch("propose_message", {
      kind: "nudge",
      to: "m-4",
      subject: "Laptop plan",
      body: "Please arrange a loaner or earlier delivery for the 2026-10-12 start because the laptop is due 2026-10-16.",
      reason: "The current ETA is after the start date.",
      evidence: ["2026-10-12", "2026-10-16"],
    });
    expect(refused.status).toBe("error");
    expect(refused.summary).toContain("current equipment task owner it-1");
    expect(runtime.state.proposals).toHaveLength(0);
  });

  it("preserves rejected and sent drafts as history without resurrecting unchanged decisions", async () => {
    const rejectedInitial = await prepareDemo(undefined, "mock", "J-004");
    const rejected = await resolveDemoApproval(rejectedInitial, "reject", "pp-1", NOW);
    const rejectedPreparation = { ...rejectedInitial, run_id: rejected.run_id, decision: rejected.decision, draft: rejected.draft, afterApproval: rejected.afterApproval, trace: rejected.trace };
    const unchanged = await reassessDemoEquipment(rejectedPreparation, "mock", "2026-09-30T10:01:00Z");
    expect(unchanged.run_id).toBe(rejected.run_id);
    expect(unchanged.case.drafts.find((draft) => draft.id === rejected.draft.id)).toMatchObject({ status: "rejected", decided_by: "pp-1" });
    expect(unchanged.case.drafts.filter((draft) => draft.workstream === "equipment" && draft.status === "pending")).toHaveLength(0);

    resetDemoState();
    const sentInitial = await prepareDemo(undefined, "mock", "J-004");
    const approved = await resolveDemoApproval(sentInitial, "approve", "pp-1", NOW);
    const approvedPreparation = { ...sentInitial, run_id: approved.run_id, decision: approved.decision, draft: approved.draft, afterApproval: approved.afterApproval, trace: approved.trace };
    await update("J-004", "2026-10-19", "backordered", "2026-09-30T10:02:00Z");
    const changed = await reassessDemoEquipment(approvedPreparation, "mock", "2026-09-30T10:02:00Z");
    expect(sent).toHaveLength(1);
    expect(changed.case.drafts.find((draft) => draft.id === approved.draft.id)).toMatchObject({ status: "approved", decided_by: "pp-1" });
    expect(changed.draft).toMatchObject({ status: "pending", equipment_source_revision: 2 });
    expect(changed.draft?.id).not.toBe(approved.draft.id);
  });

  it("refuses stale approval before send and recovers through equipment-only reassessment", async () => {
    const initial = await prepareDemo(undefined, "mock", "J-004");
    const staleDraftId = initial.draft!.id;
    await update("J-004", "2026-10-19", "backordered");

    let recovery;
    try {
      await resolveDemoApproval(initial, "approve", "pp-1", NOW);
      throw new Error("Expected stale equipment approval to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(EquipmentApprovalConflict);
      recovery = (error as EquipmentApprovalConflict).preparation;
    }
    expect(sent).toHaveLength(0);
    expect(recovery.facts).toMatchObject({ equipment_eta: "2026-10-19", equipment_late: true });
    expect(recovery.draft).toBeNull();
    expect(recovery.case.drafts.find((draft) => draft.id === staleDraftId)).toMatchObject({ status: "rejected", decided_by: "system" });

    const retried = await retryAgent(recovery, "mock", "2026-09-30T10:01:00Z");
    expect(retried.draft).toMatchObject({ status: "pending", equipment_source_revision: 2 });
    expect(retried.draft?.id).not.toBe(staleDraftId);
    expect(new Set(retried.agent?.steps.map((step) => step.tool))).toEqual(new Set(["get_case_state", "check_equipment", "propose_message", "finish"]));
  });

  it("retires a draft if the source changes during generation and keeps the latest facts", async () => {
    const initial = await prepareDemo(undefined, "mock", "J-001");
    await update("J-001", "2026-10-09", "backordered");
    const getOrder = action("equipment.get_order");
    const originalRead = getOrder.run;
    let reads = 0;
    getOrder.run = async (args) => {
      reads += 1;
      if (reads === 3) await update("J-001", "2026-10-10", "backordered", "2026-09-30T10:01:00Z");
      return originalRead(args);
    };
    try {
      const result = await reassessDemoEquipment(initial, "mock", NOW);
      expect(result.facts).toMatchObject({ equipment_eta: "2026-10-10", equipment_late: true });
      expect(result.draft).toBeNull();
      expect(result.draft_unavailable?.message).toContain("changed while Athena was preparing");
      expect(result.case.drafts.filter((draft) => draft.workstream === "equipment" && draft.status === "pending")).toHaveLength(0);
    } finally {
      getOrder.run = originalRead;
    }
  });

  it.each([
    ["J-001", "returned error"],
    ["J-004", "thrown error"],
  ] as const)("retires the generated draft and remains retryable for %s after a final supplier %s", async (joinerId, failureKind) => {
    const initial = await prepareDemo(undefined, "mock", joinerId);
    await update(joinerId, "2026-10-19", "backordered");
    const getOrder = action("equipment.get_order");
    const originalRead = getOrder.run;
    let reads = 0;
    getOrder.run = async (args) => {
      reads += 1;
      if (reads === 3) {
        if (failureKind === "thrown error") throw new Error("Supplier read temporarily failed.");
        return { status: "error", summary: "Supplier read temporarily failed." };
      }
      return originalRead(args);
    };
    try {
      const failed = await reassessDemoEquipment(initial, "mock", NOW);
      expect(failed.draft).toBeNull();
      expect(failed.draft_unavailable?.message).toContain("final supplier check failed");
      expect(failed.case.drafts.filter((draft) => draft.workstream === "equipment" && draft.status === "pending")).toHaveLength(0);

      getOrder.run = originalRead;
      const retried = await retryAgent(failed, "mock", "2026-09-30T10:01:00Z");
      expect(retried.draft).toMatchObject({ status: "pending", equipment_source_revision: 2 });
      expect(retried.case.drafts.filter((draft) => draft.workstream === "equipment" && draft.status === "pending")).toHaveLength(1);
      expect(sent).toHaveLength(0);
    } finally {
      getOrder.run = originalRead;
    }
  });

  it("reruns a guard-failed observation once and then restores unchanged-source deduplication", async () => {
    const initial = await prepareDemo(undefined, "mock", "J-001");
    await update("J-001", "2026-10-09", "backordered");
    const preferredName = initial.joiner.preferred_name;
    initial.joiner = { ...initial.joiner, preferred_name: "x".repeat(900) };
    const failed = await reassessDemoEquipment(initial, "mock", NOW);
    expect(failed.agent?.stop_reason).toBe("guard");
    expect(failed.draft).toBeNull();
    expect(failed.draft_unavailable).toBeDefined();

    failed.joiner = { ...failed.joiner, preferred_name: preferredName };
    const retried = await retryAgent(failed, "mock", "2026-09-30T10:01:00Z");
    expect(retried.agent?.run_id).not.toBe(failed.agent?.run_id);
    expect(retried.draft).toMatchObject({ status: "pending", equipment_source_revision: 2 });
    const unchanged = await reassessDemoEquipment(retried, "mock", "2026-09-30T10:02:00Z");
    expect(unchanged.run_id).toBe(retried.run_id);
    expect(unchanged.draft?.id).toBe(retried.draft?.id);
  });

  it("keeps refreshed facts visible when the model cannot produce a draft", async () => {
    const initial = await prepareDemo(undefined, "mock", "J-001");
    await update("J-001", "2026-10-09", "backordered");
    const previousKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const failed = await reassessDemoEquipment(initial, "live", NOW);
      expect(failed.facts).toMatchObject({ equipment_eta: "2026-10-09", equipment_late: true });
      expect(failed.equipment_observation).toMatchObject({ source_revision: 2, eta: "2026-10-09" });
      expect(failed.draft).toBeNull();
      expect(failed.draft_unavailable?.message).toContain("case and dates are current");

      process.env.DEMO_MODE = "mock";
      const retried = await retryAgent(failed, "mock", "2026-09-30T10:01:00Z");
      expect(retried.draft).toMatchObject({ status: "pending", equipment_source_revision: 2 });
      expect(retried.draft_unavailable).toBeUndefined();
    } finally {
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  });
});
