import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST, resetDemoRouteState } from "@/app/api/demo/route";
import { findAction } from "@/lib/connectors/registry";
import { approveDraft, sent } from "@/lib/connectors/simulated/messaging";
import {
  EquipmentMonitor,
  equipmentMonitor,
  type EquipmentMonitorSnapshot,
} from "@/lib/monitor/equipment-monitor";
import { reassessDemoEquipment, type DemoPreparation } from "@/lib/demo-flow";
import {
  beginDemoMutation,
  demoMutationInFlight,
  endDemoMutation,
  getDemoStore,
  getDemoRun,
  listDemoRuns,
} from "@/lib/store/demo-session";
import { resetDemoState } from "@/lib/store/demo-state";

const NOW = "2026-09-30T10:00:00Z";

function post(body: Record<string, unknown> = {}) {
  return POST(new Request("http://localhost/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function snapshot(caseId?: string) {
  const suffix = caseId ? `?case_id=${caseId}` : "";
  return GET(new Request(`http://localhost/api/demo${suffix}`));
}

async function open(joinerId: "J-004" | "J-001" = "J-001") {
  const response = await post({ action: "open_case", joiner_id: joinerId });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ run_id: string; case: { id: string }; draft: { id: string } | null }>;
}

async function supplierUpdate(run: { run_id: string; case: { id: string } }, eta: string, status = "backordered") {
  const response = await post({
    action: "equipment_supplier_update",
    case_id: run.case.id,
    run_id: run.run_id,
    eta,
    status,
  });
  expect(response.status).toBe(200);
}

function updateSource(joinerId: string, eta: string, status = "backordered") {
  const connector = findAction("equipment.update_order");
  if (!connector) throw new Error("Equipment update connector missing");
  return connector.action.run({ joiner_id: joinerId, eta, status, now: NOW });
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe("autonomous equipment monitor", () => {
  beforeEach(() => {
    resetDemoState();
    resetDemoRouteState();
    process.env.DEMO_MODE = "mock";
    delete process.env.EQUIPMENT_MONITOR_MODE;
  });

  it("seeds its baseline, makes no agent call on unchanged ticks and does not churn state", async () => {
    const opened = await open();
    const initial = getDemoRun(opened.case.id)!;
    let reassessments = 0;
    const monitor = new EquipmentMonitor({
      now: () => NOW,
      reassess: async (...args) => {
        reassessments += 1;
        return reassessDemoEquipment(...args);
      },
    });
    monitor.register(initial);

    await monitor.tick();
    await monitor.tick();

    expect(reassessments).toBe(0);
    expect(monitor.snapshot()).toMatchObject({ agent_invocations: 0, notifications: [] });
    expect(getDemoRun(opened.case.id)?.run_id).toBe(opened.run_id);
    expect(getDemoRun(opened.case.id)?.draft).toBeNull();
  });

  it("uses one scheduler for two cases, repeated opens and read-only snapshots", async () => {
    expect((await (await snapshot()).json() as { cases: unknown[] }).cases).toHaveLength(0);
    await open("J-004");
    await open("J-004");
    await open("J-001");
    await snapshot();
    await snapshot();

    expect(equipmentMonitor.snapshot()).toMatchObject({
      running: true,
      scheduler_starts: 1,
      agent_invocations: 0,
    });
    expect(equipmentMonitor.snapshot().cases).toHaveLength(2);
  });

  it("detects a source-only change independently and publishes exactly one proposal and notification", async () => {
    const opened = await open();
    await supplierUpdate(opened, "2026-10-09");
    expect(getDemoRun(opened.case.id)?.run_id).toBe(opened.run_id);
    expect(getDemoRun(opened.case.id)?.draft).toBeNull();

    await equipmentMonitor.tick();
    const after = getDemoRun(opened.case.id)!;
    const firstDraftId = after.draft?.id;
    expect(after.facts).toMatchObject({ start_date: "2026-10-05", equipment_eta: "2026-10-09", equipment_late: true });
    expect(after.draft).toMatchObject({ status: "pending", to: "it-1", equipment_source_revision: 2 });
    const monitorEvents = after.trace.filter((entry) => entry.kind.startsWith("equipment.")).map((entry) => entry.kind);
    expect(monitorEvents).toEqual(expect.arrayContaining(["equipment.source.changed", "equipment.monitor.detected", "equipment.monitor.proposed"]));
    expect(monitorEvents.indexOf("equipment.source.changed")).toBeLessThan(monitorEvents.indexOf("equipment.monitor.detected"));
    expect(monitorEvents.indexOf("equipment.monitor.detected")).toBeLessThan(monitorEvents.indexOf("equipment.monitor.proposed"));
    expect(equipmentMonitor.snapshot()).toMatchObject({ agent_invocations: 1 });
    expect(equipmentMonitor.snapshot().notifications).toEqual([
      expect.objectContaining({
        equipment_eta: "2026-10-09",
        start_date: "2026-10-05",
        outcome: "proposal_prepared",
      }),
    ]);

    await equipmentMonitor.tick();
    expect(getDemoRun(opened.case.id)?.run_id).toBe(after.run_id);
    expect(getDemoRun(opened.case.id)?.draft?.id).toBe(firstDraftId);
    expect(equipmentMonitor.snapshot()).toMatchObject({ agent_invocations: 1 });
    expect(equipmentMonitor.snapshot().notifications).toHaveLength(1);
  });

  it("defers while a route mutation owns the shared coordination boundary", async () => {
    const opened = await open();
    await updateSource("J-001", "2026-10-09");
    let reassessments = 0;
    const monitor = new EquipmentMonitor({
      reassess: async (...args) => {
        reassessments += 1;
        return reassessDemoEquipment(...args);
      },
    });
    monitor.register(getDemoRun(opened.case.id)!);
    const token = beginDemoMutation();
    expect(token).not.toBeNull();
    try {
      await monitor.tick();
    } finally {
      endDemoMutation(token!);
    }
    expect(reassessments).toBe(0);
    expect(monitor.snapshot().agent_invocations).toBe(0);
  });

  it("discards generated work when the supplier changes again before commit", async () => {
    const opened = await open();
    await updateSource("J-001", "2026-10-09");
    const ready = deferred();
    const continueCommit = deferred();
    let generatedDraftId: string | null = null;
    const monitor = new EquipmentMonitor({
      reassess: async (...args) => {
        const result = await reassessDemoEquipment(...args);
        generatedDraftId = result.draft?.id ?? null;
        ready.release();
        await continueCommit.promise;
        return result;
      },
    });
    monitor.register(getDemoRun(opened.case.id)!);

    const ticking = monitor.tick();
    await ready.promise;
    await updateSource("J-001", "2026-10-10");
    continueCommit.release();
    await ticking;

    expect(generatedDraftId).not.toBeNull();
    expect(getDemoRun(opened.case.id)?.run_id).toBe(opened.run_id);
    expect(getDemoRun(opened.case.id)?.draft).toBeNull();
    expect(approveDraft(generatedDraftId!, "pp-1", "approve")).toBe(false);
    expect(monitor.snapshot().notifications).toHaveLength(0);
    expect(monitor.snapshot().cases[0]).toMatchObject({
      state: "watching",
      next_action: "A newer supplier update will be checked on the next tick.",
    });
  });

  it("lets reset invalidate an in-flight tick and prevents the old completion restoring state", async () => {
    const opened = await open();
    await updateSource("J-001", "2026-10-09");
    const ready = deferred();
    const continueCommit = deferred();
    let generatedDraftId: string | null = null;
    const monitor = new EquipmentMonitor({
      reassess: async (...args) => {
        const result = await reassessDemoEquipment(...args);
        generatedDraftId = result.draft?.id ?? null;
        ready.release();
        await continueCommit.promise;
        return result;
      },
    });
    monitor.register(getDemoRun(opened.case.id)!);

    const ticking = monitor.tick();
    await ready.promise;
    const reset = await post({ action: "reset" });
    expect(reset.status).toBe(200);
    continueCommit.release();
    await ticking;

    expect(listDemoRuns()).toHaveLength(0);
    expect(generatedDraftId).not.toBeNull();
    expect(approveDraft(generatedDraftId!, "pp-1", "approve")).toBe(false);
    expect((await (await snapshot()).json() as { cases: unknown[] }).cases).toHaveLength(0);
  });

  it("retries one failed observation once, then needs attention until a new observation arrives", async () => {
    const opened = await open();
    await updateSource("J-001", "2026-10-09");
    let calls = 0;
    const monitor = new EquipmentMonitor({
      now: () => NOW,
      reassess: async (run) => {
        calls += 1;
        const source = await (async () => {
          const action = findAction("equipment.get_order")!;
          const result = await action.action.run({ joiner_id: run.joiner.id });
          const data = result.data as { eta: string; status: "ordered" | "backordered"; source_revision: number; signature: string; order_id: string; joiner_id: string };
          return data;
        })();
        return {
          ...run,
          equipment_observation: source,
          facts: { ...run.facts, equipment_eta: source.eta, equipment_late: true },
          draft: null,
          draft_unavailable: { message: "Injected model timeout.", retry_action: "retry_agent" },
        } as DemoPreparation;
      },
    });
    monitor.register(getDemoRun(opened.case.id)!);

    await monitor.tick();
    await monitor.tick();
    await monitor.tick();
    expect(calls).toBe(2);
    expect(monitor.snapshot().cases[0]).toMatchObject({ state: "needs_attention", failed_attempts: 2 });

    const failedRun = getDemoRun(opened.case.id)!;
    const retry = await post({ action: "retry_agent", case_id: failedRun.case.id, run_id: failedRun.run_id });
    expect(retry.status).toBe(200);
    await monitor.tick();
    expect(calls).toBe(2);
    expect(monitor.snapshot().cases[0]).toMatchObject({ state: "watching", failed_attempts: 0, last_error: null });

    await updateSource("J-001", "2026-10-10");
    await monitor.tick();
    expect(calls).toBe(3);
  });

  it("pauses visibly at the session ceiling and opening another tab cannot bypass it", async () => {
    const opened = await open();
    await updateSource("J-001", "2026-10-09");
    const monitor = new EquipmentMonitor({ maxInvocations: 0 });
    monitor.register(getDemoRun(opened.case.id)!);
    monitor.register(getDemoRun(opened.case.id)!);
    await monitor.tick();

    expect(monitor.snapshot()).toMatchObject({ agent_invocations: 0, max_agent_invocations: 0 });
    expect(monitor.snapshot().cases[0]).toMatchObject({
      state: "paused",
      next_action: "Equipment monitoring reached its local session limit.",
    });
  });

  it("returns monitor state from GET without opening a case or causing work", async () => {
    const first = await (await snapshot()).json() as { busy: boolean; monitor: EquipmentMonitorSnapshot; cases: unknown[] };
    const second = await (await snapshot()).json() as typeof first;
    expect(first).toMatchObject({ busy: false, cases: [], monitor: { running: false, agent_invocations: 0, notifications: [] } });
    expect(second).toEqual(first);
    expect(listDemoRuns()).toHaveLength(0);
  });

  it("keeps monitor and foreground history authoritative through a later date change", async () => {
    const opened = await open();
    await supplierUpdate(opened, "2026-10-09");
    await equipmentMonitor.tick();
    const monitored = getDemoRun(opened.case.id)!;

    const equipmentApproved = await (await post({ case_id: monitored.case.id, run_id: monitored.run_id, decision: "approve" })).json() as {
      run_id: string;
      draft: { id: string; status: string };
    };
    const equipmentDraftId = equipmentApproved.draft.id;
    const managerPrepared = await (await post({ case_id: monitored.case.id, run_id: equipmentApproved.run_id, action: "manager_prepare" })).json() as {
      run_id: string;
      manager_coordination: { request: { id: string }; draft: { id: string } };
    };
    const managerRequestId = managerPrepared.manager_coordination.request.id;
    const managerDraftId = managerPrepared.manager_coordination.draft.id;
    const managerApproved = await (await post({
      case_id: monitored.case.id,
      run_id: managerPrepared.run_id,
      action: "manager_decision",
      request_id: managerRequestId,
      draft_id: managerDraftId,
      decision: "approve",
    })).json() as { run_id: string };
    const managerResponded = await (await post({ case_id: monitored.case.id, run_id: managerApproved.run_id, action: "manager_response", request_id: managerRequestId })).json() as { run_id: string };
    const managerConfirmed = await (await post({ case_id: monitored.case.id, run_id: managerResponded.run_id, action: "manager_confirm", request_id: managerRequestId })).json() as { run_id: string };

    const storedBeforeMove = getDemoStore().get(monitored.case.id)!;
    expect(storedBeforeMove.drafts.map((draft) => draft.id)).toEqual(expect.arrayContaining([equipmentDraftId, managerDraftId]));
    expect(storedBeforeMove.manager_plans?.at(-1)).toMatchObject({ id: managerRequestId, status: "confirmed" });

    const moved = await (await post({ case_id: monitored.case.id, run_id: managerConfirmed.run_id, action: "start_date_change", start_date: "2026-10-19" })).json() as {
      manager_coordination: { request: { id: string; status: string } | null };
    };
    expect(moved.manager_coordination.request).toMatchObject({ id: managerRequestId, status: "superseded" });
    const storedAfterMove = getDemoStore().get(monitored.case.id)!;
    expect(storedAfterMove.drafts.map((draft) => draft.id)).toEqual(expect.arrayContaining([equipmentDraftId, managerDraftId]));
    expect(storedAfterMove.drafts.find((draft) => draft.id === equipmentDraftId)?.status).toBe("approved");
    expect(sent.map((message) => message.draft_id)).toEqual(expect.arrayContaining([equipmentDraftId, managerDraftId]));
  });

  it("preserves filed access receipts and confirmed buddy history after a monitored case changes date", async () => {
    const opened = await open("J-004");
    await supplierUpdate(opened, "2026-10-19");
    await equipmentMonitor.tick();
    const monitored = getDemoRun(opened.case.id)!;

    const access = await (await post({ case_id: monitored.case.id, run_id: monitored.run_id, action: "access_request" })).json() as {
      run_id: string;
      onboarding: { access: Array<{ request_id: string | null }> };
    };
    const accessRequestIds = access.onboarding.access.map((row) => row.request_id);
    expect(accessRequestIds.every(Boolean)).toBe(true);
    const withAccess = getDemoRun(opened.case.id)!;
    const buddyRequest = withAccess.buddy.request;
    expect(buddyRequest).not.toBeNull();

    const buddyApproved = await (await post({
      case_id: withAccess.case.id,
      run_id: access.run_id,
      action: "buddy_decision",
      request_id: buddyRequest!.id,
      draft_id: buddyRequest!.draft_id,
      decision: "approve",
    })).json() as { run_id: string };
    const buddyAccepted = await (await post({
      case_id: withAccess.case.id,
      run_id: buddyApproved.run_id,
      action: "buddy_response",
      request_id: buddyRequest!.id,
      response: "accepted",
    })).json() as { run_id: string };
    const buddyConfirmed = await (await post({
      case_id: withAccess.case.id,
      run_id: buddyAccepted.run_id,
      action: "buddy_confirm",
      request_id: buddyRequest!.id,
    })).json() as { run_id: string };

    const moved = await (await post({
      case_id: withAccess.case.id,
      run_id: buddyConfirmed.run_id,
      action: "start_date_change",
      start_date: "2026-10-19",
    })).json() as { onboarding: { access: Array<{ request_id: string | null }> } };
    expect(moved.onboarding.access.map((row) => row.request_id)).toEqual(accessRequestIds);
    const stored = getDemoStore().get(withAccess.case.id)!;
    expect(stored.buddy_requests.find((request) => request.id === buddyRequest!.id)).toMatchObject({ status: "superseded" });
  });

  it("reset during opening prevents the old request restoring a case or monitor", async () => {
    const order = findAction("equipment.order");
    if (!order) throw new Error("Equipment order connector missing");
    const originalOrder = order.action.run;
    const started = deferred();
    const continueOpen = deferred();
    order.action.run = async (args) => {
      if (args.joiner_id === "J-001") {
        started.release();
        await continueOpen.promise;
      }
      return originalOrder(args);
    };
    try {
      const opening = post({ action: "open_case", joiner_id: "J-001" });
      await started.promise;
      expect((await post({ action: "reset" })).status).toBe(200);
      continueOpen.release();
      expect((await opening).status).toBe(409);
      expect(listDemoRuns()).toHaveLength(0);
      expect(equipmentMonitor.snapshot()).toMatchObject({ running: false, scheduler_starts: 0, cases: [] });
    } finally {
      order.action.run = originalOrder;
      continueOpen.release();
    }
  });

  it("reset invalidates an existing-case mutation without letting its old token release the new session", async () => {
    const opened = await open("J-004");
    const managerPrepared = await (await post({ case_id: opened.case.id, run_id: opened.run_id, action: "manager_prepare" })).json() as {
      run_id: string;
      manager_coordination: { request: { id: string }; draft: { id: string } };
    };
    const slack = findAction("slack.send_message");
    const order = findAction("equipment.order");
    if (!slack || !order) throw new Error("Required simulated connector missing");
    const originalSlack = slack.action.run;
    const originalOrder = order.action.run;
    const oldStarted = deferred();
    const continueOld = deferred();
    const newStarted = deferred();
    const continueNew = deferred();
    slack.action.run = async (args) => {
      oldStarted.release();
      await continueOld.promise;
      return originalSlack(args);
    };
    order.action.run = async (args) => {
      if (args.joiner_id === "J-001") {
        newStarted.release();
        await continueNew.promise;
      }
      return originalOrder(args);
    };
    try {
      const oldMutation = post({
        case_id: opened.case.id,
        run_id: managerPrepared.run_id,
        action: "manager_decision",
        request_id: managerPrepared.manager_coordination.request.id,
        draft_id: managerPrepared.manager_coordination.draft.id,
        decision: "approve",
      });
      await oldStarted.promise;
      expect((await post({ action: "reset" })).status).toBe(200);

      const newOpening = post({ action: "open_case", joiner_id: "J-001" });
      await newStarted.promise;
      continueOld.release();
      expect((await oldMutation).status).toBe(409);
      expect(demoMutationInFlight()).toBe(true);

      continueNew.release();
      expect((await newOpening).status).toBe(200);
      expect(listDemoRuns()).toHaveLength(1);
      expect(listDemoRuns()[0].case.id).toBe("CASE-J-001");
      expect(sent).toHaveLength(0);
    } finally {
      slack.action.run = originalSlack;
      order.action.run = originalOrder;
      continueOld.release();
      continueNew.release();
    }
  });
});
