import { beforeEach, expect, it } from "vitest";
import { prepareDemo } from "@/lib/demo-flow";
import { resetDemoState } from "@/lib/store/demo-state";
import { askCase } from "@/lib/agent/ask";
import { askIntentFor } from "@/lib/ask-intent";
import { POST, resetDemoRouteState } from "@/app/api/demo/route";

beforeEach(() => { resetDemoState(); resetDemoRouteState(); process.env.DEMO_MODE = "mock"; });

it.each(["Open Priya Raman’s profile.", "Show me Alex Smith's profile", "Open the profile for Priya Raman.", "Show Aisha's manager's profile"])("clarifies another person's profile: %s", async (question) => {
  const run = await prepareDemo(undefined, "mock");
  const before = JSON.stringify({ tasks: run.case.tasks, drafts: run.case.drafts });
  const answer = await askCase(run.case, run.joiner, question, "mock");
  expect(answer).toMatchObject({ clarification: "person", card: null, links: [], provider: "system", cost_usd: 0 });
  expect(answer.answer).toContain("scoped to Aisha Okafor");
  expect(JSON.stringify({ tasks: run.case.tasks, drafts: run.case.drafts })).toBe(before);
});

it.each(["Open Aisha’s profile.", "Show Aisha Okafor's profile", "Open her profile", "Show the profile for Aisha Okafor.", "Check profile setup"])("keeps current-case profile requests working: %s", async (question) => {
  const run = await prepareDemo(undefined, "mock");
  const answer = await askCase(run.case, run.joiner, question, "mock");
  expect(answer).not.toHaveProperty("clarification");
  expect(answer.answer).toContain("Profile setup still needs");
});

it.each([
  ["When does Priya start?", "date_question"],
  ["Check Priya's access requests", "access"],
  ["Coordinate with Priya's manager", "manager"],
] as const)("requires a case switch before answering another supported joiner: %s", async (question, intent) => {
  const run = await prepareDemo(undefined, "mock");
  const before = JSON.stringify({ tasks: run.case.tasks, drafts: run.case.drafts, manager: run.case.manager_plans });
  expect(askIntentFor(question)).toBe(intent);
  const answer = await askCase(run.case, run.joiner, question, "mock");
  expect(answer).toMatchObject({ clarification: "person", switch_joiner_id: "J-001", provider: "system", card: null, links: [] });
  expect(answer.answer).toContain("Switch to Priya Raman");
  expect(answer.answer).not.toContain("12 Oct");
  expect(answer.answer).not.toContain("Chloe Bennett");
  expect(JSON.stringify({ tasks: run.case.tasks, drafts: run.case.drafts, manager: run.case.manager_plans })).toBe(before);
});

it("applies the same person scope when Priya is open", async () => {
  const run = await prepareDemo(undefined, "mock", "J-001");
  const answer = await askCase(run.case, run.joiner, "Who is Aisha's manager?", "mock");
  expect(answer).toMatchObject({ clarification: "person", switch_joiner_id: "J-004", provider: "system" });
  expect(answer.answer).toContain("Switch to Aisha Okafor");
  expect(answer.answer).not.toContain("Rachel Adeyemi");
});

it.each([
  ["Do I have Salesforce access?", "access", "0 requests have been submitted"],
  ["Can I access Salesforce?", "access", "A request does not mean access has been granted"],
  ["What should I expect on my first day?", "joiner", "not recorded"],
  ["What can I expect on my first day?", "joiner", "not recorded"],
  ["Who is Aisha's manager?", "manager", "Chloe Bennett"],
])("understands everyday questions: %s", async (question, intent, text) => {
  const run = await prepareDemo(undefined, "mock");
  expect(askIntentFor(question)).toBe(intent);
  expect((await askCase(run.case, run.joiner, question, "mock")).answer).toContain(text);
});

it("preserves unrelated intent boundaries", () => {
  expect(askIntentFor("Who owns access requests?")).toBe("owner");
  expect(askIntentFor("What should I expect from the coffee machine?")).toBe("unmatched");
  expect(askIntentFor("Is the website accessible?")).toBe("unmatched");
});

it.each(["profile", "manager"] as const)("reports cancelled %s tasks without claiming completion", async (kind) => {
  const run = await prepareDemo(undefined, "mock");
  const matches = (task: typeof run.case.tasks[number]) => kind === "profile" ? task.type === "hris_profile" : task.owner_function === "manager";
  const tasks = run.case.tasks.filter(matches);
  expect(tasks.length).toBeGreaterThan(0);
  const question = kind === "profile" ? "Open Aisha's profile" : "Who is Aisha's manager?";
  for (const task of tasks) task.status = "cancelled";
  const cancelled = (await askCase(run.case, run.joiner, question, "mock")).answer;
  expect(cancelled).toContain("cancelled");
  expect(cancelled).not.toMatch(/(?:is|are) complete/);
  run.case.tasks.push({ ...tasks[0], id: `${tasks[0].id}-done`, status: "done" });
  expect((await askCase(run.case, run.joiner, question, "mock")).answer).toContain("cancelled");
  for (const task of run.case.tasks.filter(matches)) task.status = "done";
  expect((await askCase(run.case, run.joiner, question, "mock")).answer).toMatch(/(?:is|are) complete/);
  run.case.tasks = run.case.tasks.filter((task) => !matches(task));
  expect((await askCase(run.case, run.joiner, question, "mock")).answer).toMatch(/not recorded|No manager task/);
});

it("returns clarification through the API and allows a current-person follow-up", async () => {
  const post = async (body: unknown) => {
    const response = await POST(new Request("http://localhost/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
    return response.json();
  };
  const first = await post({ action: "ask", question: "Open Priya Raman's profile" });
  expect(first.answer.clarification).toBe("person");
  const next = await post({ action: "ask", case_id: first.case.id, run_id: first.run_id, question: "Open Aisha's profile" });
  expect(next.run_id).toBe(first.run_id);
  expect(next.draft.id).toBe(first.draft.id);
  expect(next.answer.clarification).toBeUndefined();
});
