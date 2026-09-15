import { beforeEach, describe, expect, it } from "vitest";
import { prepareDemo, changeDemoStartDate } from "@/lib/demo-flow";
import { resetDemoState } from "@/lib/store/demo-state";
import { onboardingView } from "@/lib/onboarding-view";
import { identity } from "@/lib/connectors/simulated/identity";
import { askCase } from "@/lib/agent/ask";
import { workFocusFor } from "@/app/page";
import { POST, resetDemoRouteState } from "@/app/api/demo/route";

beforeEach(() => { resetDemoState(); resetDemoRouteState(); process.env.DEMO_MODE = "mock"; });

describe("additional onboarding scenarios", () => {
  it("exposes a minimum-field profile and preserves unfinished setup", async () => {
    const run = await prepareDemo(undefined, "mock");
    const view = onboardingView(run.case, run.joiner);
    expect(view.profile.name).toBe("Aisha Okafor");
    expect(view.profile.manager_name).toBe("Chloe Bennett");
    expect(view.profile.setup[0].status).not.toBe("done");
    expect(view.tasks).toHaveLength(run.case.tasks.length);
    // A task type may name right_to_work; the underlying identity record must stay private.
    expect(view.profile).not.toHaveProperty("right_to_work");
    const raw = JSON.stringify(view);
    expect(raw).not.toContain(run.joiner.personal_email);
    expect(raw).not.toContain(run.joiner.right_to_work.document!);
    for (const privateField of ["personal_email", "demo_note", "document", "bank"]) expect(raw).not.toContain(privateField);
  });

  it("does not confuse an access task with a filed request or granted access", async () => {
    const run = await prepareDemo(undefined, "mock");
    const before = onboardingView(run.case, run.joiner);
    expect(before.access).toHaveLength(6);
    expect(before.access.every((row) => row.request_status === "not_submitted")).toBe(true);
    expect(before.access.find((row) => row.system === "salesforce")?.approver_name).toBe("Chloe Bennett");
    await identity.actions.request_access.run({ joiner_id: run.joiner.id, system: "salesforce", level: "standard", approver: "manager", now: "2026-09-30T09:00:00Z" });
    const after = onboardingView(run.case, run.joiner);
    expect(after.access.find((row) => row.system === "salesforce")?.request_status).toBe("requested");
    expect(after.access.filter((row) => row.request_id)).toHaveLength(1);
    expect(JSON.stringify(after.access)).not.toContain('"granted"');
  });

  it("refreshes profile and manager deadlines from a changed case", async () => {
    const run = await prepareDemo(undefined, "mock");
    const before = onboardingView(run.case, run.joiner);
    await changeDemoStartDate(run, "2026-10-19");
    const after = onboardingView(run.case, run.joiner);
    expect(after.profile.start_date).toBe("2026-10-19");
    expect(after.first_day.start_date).toBe("2026-10-19");
    expect(after.manager.tasks[0].due_at).not.toBe(before.manager.tasks[0].due_at);
    expect(after.first_day.arrival_time).toBeNull();
    expect(after.first_day.office_address).toBeNull();
  });

  it("answers and focuses each scenario without sending or completing tasks", async () => {
    const run = await prepareDemo(undefined, "mock");
    const cases = [
      ["Check Aisha’s access requests.", "access", "0 requests have been submitted"],
      ["Open Aisha’s profile.", "profile", "Profile setup still needs"],
      ["Coordinate with Aisha’s manager.", "manager", "Chloe Bennett"],
      ["Answer new joiner questions.", "joiner", "not recorded"],
      ["What time should I arrive on my first day?", "joiner", "not recorded"],
    ];
    const before = JSON.stringify({ tasks: run.case.tasks, drafts: run.case.drafts });
    for (const [question, focus, text] of cases) {
      const answer = await askCase(run.case, run.joiner, question, "mock");
      expect(answer.answer).toContain(text);
      expect(workFocusFor(question, answer.card)).toBe(focus);
    }
    expect(JSON.stringify({ tasks: run.case.tasks, drafts: run.case.drafts })).toBe(before);
  });

  it("returns current scenario evidence through the first-question API", async () => {
    const response = await POST(new Request("http://localhost/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ask", question: "Open Aisha’s profile." }) }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.onboarding.profile.name).toBe("Aisha Okafor");
    expect(body.answer.answer).toContain("Chloe Bennett");
    expect(body.draft.status).toBe("pending");
    expect(body.onboarding.tasks).toHaveLength(body.case.task_count);
  });
});
