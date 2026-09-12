import { describe, it, expect, beforeEach } from "vitest";
import { EVENTS } from "@/data/events";
import { joinerById } from "@/data/joiners";
import { CaseStore } from "@/lib/store/case-store";

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
    const r = store.applyStartDateChange(evt("EVT-013"), joinerById("J-008")!, "2026-10-03T10:00:00Z");
    expect(r.changed).toBeGreaterThan(0);
    expect(r.unchanged).toBeGreaterThan(0); // hris_profile and equipment_order key off the contract date
    expect(c.tasks.find((t) => t.type === "hris_profile")!.due_at).toBe(hrisDue);
    expect(c.tasks.find((t) => t.type === "i9_section_1")!.due_at).toBe("2026-10-19T17:00:00Z");
    expect(c.start_date).toBe("2026-10-19");
    expect(store.contracts.get(c.id)!.goal).toContain("2026-10-19");
  });
});
