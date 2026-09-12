import { describe, it, expect, beforeEach } from "vitest";
import { EVENTS } from "@/data/events";
import { joinerById } from "@/data/joiners";
import { CaseStore } from "@/lib/store/case-store";
import { findAction } from "@/lib/connectors/registry";
import { deriveState } from "@/lib/state-machine";

const NOW = "2026-09-30T09:00:00Z";
const evt = (id: string) => EVENTS.find((e) => e.event_id === id)!;

let store: CaseStore;
beforeEach(() => {
  store = new CaseStore();
});

describe("clean UK joiner (J-001)", () => {
  it("plans the UK items with deadlines from policy", () => {
    const r = store.open(evt("EVT-001"), joinerById("J-001"), NOW);
    expect(r.outcome).toBe("opened");
    const c = r.case!;
    const byType = Object.fromEntries(c.tasks.map((t) => [t.type + (t.system ? `:${t.system}` : ""), t]));
    expect(byType.right_to_work.due_at).toBe("2026-10-02T17:00:00Z"); // 1 working day before Mon 5 Oct
    expect(byType.right_to_work.compliance_code).toBe("UK_RTW");
    expect(byType.manager_day_one_plan.due_at).toBe("2026-09-30T17:00:00Z"); // Wednesday before
    expect(byType["access_request:github"].due_at).toBe("2026-10-01T17:00:00Z"); // 2 working days before
    expect(byType.hris_profile.due_at).toBe("2026-09-28T17:00:00Z"); // contract Fri 25 Sep + 1 wd
    expect(c.tasks.filter((t) => t.type === "access_request")).toHaveLength(5);
    expect(c.escalations).toHaveLength(0);
    expect(c.state).toBe("in_progress");
  });
  it("ignores a redelivered event with the same id", () => {
    store.open(evt("EVT-001"), joinerById("J-001"), NOW);
    const again = store.open(EVENTS[3], joinerById("J-001"), NOW); // the replay
    expect(again.outcome).toBe("duplicate");
    expect(store.list()).toHaveLength(1);
    expect(again.case!.escalations.some((e) => e.code === "DUPLICATE_EVENT" && e.resolved_at)).toBe(true);
  });

  it("preserves the existing case when a different event id repeats the same hire", () => {
    const opened = store.open(evt("EVT-001"), joinerById("J-001"), NOW).case!;
    const originalTaskIds = opened.tasks.map((task) => task.id);
    opened.drafts.push({
      id: "D-CASE-1",
      case_id: opened.id,
      kind: "nudge",
      channel: "slack",
      to: "m-1",
      body: "Approved copy",
      status: "approved",
      created_at: NOW,
      decided_at: NOW,
      decided_by: "m-1",
    });

    const secondDelivery = store.open(
      { ...evt("EVT-001"), event_id: "EVT-014" },
      joinerById("J-001"),
      NOW,
    );

    expect(secondDelivery.outcome).toBe("duplicate");
    expect(store.list()).toHaveLength(1);
    expect(secondDelivery.case).toBe(opened);
    expect(opened.tasks.map((task) => task.id)).toEqual(originalTaskIds);
    expect(opened.drafts).toHaveLength(1);
    expect(opened.steps.some((step) => step.kind === "event.duplicate")).toBe(true);
  });
});

describe("compliance and routing edge cases", () => {
  it("escalates unevidenced right to work at the at-risk date (J-002, DE)", () => {
    const c = store.open(evt("EVT-002"), joinerById("J-002"), NOW).case!;
    const e = c.escalations.find((x) => x.code === "RTW_NOT_EVIDENCED");
    expect(e?.severity).toBe("critical");
    expect(c.state).toBe("blocked");
    expect(c.tasks.find((t) => t.type === "right_to_work")?.status).toBe("escalated");
    expect(c.tasks.find((t) => t.type === "works_council_notice")?.due_at).toBe("2026-09-28T17:00:00Z");
  });
  it("does not escalate right to work before the at-risk date", () => {
    const c = store.open(evt("EVT-002"), joinerById("J-002"), "2026-09-25T09:00:00Z").case!;
    expect(c.escalations.find((x) => x.code === "RTW_NOT_EVIDENCED")).toBeUndefined();
  });
  it("routes manager tasks to the deputy while the manager is on leave (J-003)", () => {
    const c = store.open(evt("EVT-003"), joinerById("J-003"), NOW).case!;
    expect(c.tasks.find((t) => t.type === "manager_day_one_plan")?.owner_id).toBe("m-8");
    expect(c.escalations.find((x) => x.code === "MANAGER_UNAVAILABLE")?.severity).toBe("info");
    expect(c.tasks.find((t) => t.type === "i9_section_2")?.due_at).toBe("2026-10-08T17:00:00Z");
  });
  it("escalates when the buddy filter returns nobody (J-005, Munich office)", () => {
    const c = store.open(evt("EVT-005"), joinerById("J-005"), NOW).case!;
    expect(c.escalations.find((x) => x.code === "NO_ELIGIBLE_BUDDY")).toBeDefined();
  });
  it("rejects a contractor as out of scope (J-009)", () => {
    const r = store.open(evt("EVT-009"), joinerById("J-009"), NOW);
    expect(r.outcome).toBe("rejected");
    expect(r.case!.state).toBe("rejected");
    expect(r.case!.tasks).toHaveLength(0);
  });
  it("re-dates only the tasks whose deadline moved on a start-date change (J-008)", () => {
    const c = store.open(evt("EVT-008"), joinerById("J-008"), NOW).case!;
    const hrisDue = c.tasks.find((t) => t.type === "hris_profile")!.due_at;
    const completed = c.tasks.find((t) => t.type === "i9_section_1")!;
    completed.status = "done";
    completed.done_at = NOW;
    completed.done_by = "pp-2";
    const r = store.applyStartDateChange(evt("EVT-013"), joinerById("J-008")!, "2026-10-03T10:00:00Z");
    expect(r.changed).toBeGreaterThan(0);
    expect(r.unchanged).toBeGreaterThan(0); // hris_profile and equipment_order key off the contract date
    expect(c.tasks.find((t) => t.type === "hris_profile")!.due_at).toBe(hrisDue);
    expect(c.tasks.find((t) => t.type === "i9_section_1")!.due_at).toBe("2026-10-19T17:00:00Z");
    expect(c.tasks.find((t) => t.type === "i9_section_1")!.status).toBe("done");
    expect(c.tasks.find((t) => t.type === "i9_section_1")!.done_by).toBe("pp-2");
    expect(c.tasks.find((t) => t.type === "equipment_order")!.detail).toContain("2026-10-14");
    expect(c.tasks.find((t) => t.type === "equipment_order")!.detail).not.toContain("2026-10-07");
    expect(c.start_date).toBe("2026-10-19");
    expect(store.contracts.get(c.id)!.goal).toContain("2026-10-19");
  });

  it("reconciles a newly at-risk compliance date instead of discarding the escalation", () => {
    const c = store.open(evt("EVT-002"), joinerById("J-002"), "2026-09-25T09:00:00Z").case!;
    expect(c.escalations.find((e) => e.code === "RTW_NOT_EVIDENCED")).toBeUndefined();

    const r = store.applyStartDateChange(
      {
        event_id: "EVT-015",
        type: "joiner.start_date_changed",
        occurred_at: "2026-09-30T10:00:00Z",
        joiner_id: "J-002",
        payload: { start_date: "2026-10-01", reason: "Earlier start agreed" },
      },
      joinerById("J-002")!,
      "2026-09-30T10:00:00Z",
    );

    expect(r.case!.escalations.find((e) => e.code === "RTW_NOT_EVIDENCED" && !e.resolved_at)?.severity).toBe("critical");
    expect(r.case!.state).toBe("blocked");
  });

  it("clears a stale compliance risk when a later start date moves outside the at-risk window", () => {
    const c = store.open(evt("EVT-002"), joinerById("J-002"), NOW).case!;
    expect(c.state).toBe("blocked");

    const r = store.applyStartDateChange(
      {
        event_id: "EVT-016",
        type: "joiner.start_date_changed",
        occurred_at: "2026-09-30T10:00:00Z",
        joiner_id: "J-002",
        payload: { start_date: "2026-10-19", reason: "Start date deferred" },
      },
      joinerById("J-002")!,
      NOW,
    );

    expect(r.case!.escalations.find((e) => e.code === "RTW_NOT_EVIDENCED" && !e.resolved_at)).toBeUndefined();
    expect(r.case!.escalations.find((e) => e.code === "RTW_NOT_EVIDENCED")?.resolved_by).toBe("system");
    expect(r.case!.state).toBe("in_progress");
  });

  it("requires named compliance evidence and a confirmed buddy, but ignores tasks due after day one", () => {
    const c = store.open(evt("EVT-011"), joinerById("J-011"), NOW).case!;
    for (const task of c.tasks) task.status = "cancelled";
    expect(deriveState(c)).toBe("in_progress");

    const sectionOne = c.tasks.find((task) => task.type === "i9_section_1")!;
    sectionOne.status = "done";
    sectionOne.done_by = "pp-2";
    sectionOne.done_at = NOW;
    const buddy = c.tasks.find((task) => task.type === "buddy_allocation")!;
    buddy.status = "done";
    buddy.done_by = "pp-2";
    buddy.done_at = NOW;
    c.buddy_id = "b-01";
    const postStart = c.tasks.find((task) => task.type === "i9_section_2")!;
    postStart.status = "open";

    expect(deriveState(c)).toBe("ready_for_day_one");
  });

  it("updates the authoritative HRIS record after a start-date change", async () => {
    store.open(evt("EVT-008"), joinerById("J-008"), NOW);
    store.applyStartDateChange(evt("EVT-013"), joinerById("J-008")!, "2026-10-03T10:00:00Z");
    const action = findAction("hris.get_joiner")!;
    const result = await action.action.run({ joiner_id: "J-008" });
    expect(result.status).toBe("ok");
    expect((result.data as { start_date: string }).start_date).toBe("2026-10-19");
  });
});
