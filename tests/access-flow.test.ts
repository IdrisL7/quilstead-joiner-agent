import { beforeEach, describe, expect, it } from "vitest";
import { POST, resetDemoRouteState } from "@/app/api/demo/route";
import { createAgentToolRuntime } from "@/lib/agent/tools";
import { setSimulatedAccessFailure } from "@/lib/connectors/simulated/identity";
import { prepareDemo, retryAgent } from "@/lib/demo-flow";
import { resetDemoState } from "@/lib/store/demo-state";

function request(body: Record<string, unknown> = {}) {
  const payload = typeof body.run_id === "string" && body.case_id === undefined
    ? { ...body, case_id: "CASE-J-004" }
    : body;
  return new Request("http://localhost/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("access-request workflow", () => {
  beforeEach(() => {
    resetDemoState();
    resetDemoRouteState();
    process.env.DEMO_MODE = "mock";
  });

  it("keeps an access recovery run on the access-only tool set", async () => {
    const failedPreparation = await prepareDemo(undefined, "mock");
    failedPreparation.agent = {
      ...failedPreparation.agent!,
      trigger: "access_requested",
      stop_reason: "guard",
      next_action: "Run assistant again.",
      proposals: [],
    };
    failedPreparation.draft_unavailable = { message: "Assistant unavailable (guard)." };
    const recovered = await retryAgent(failedPreparation, "mock");
    expect(recovered.agent?.trigger).toBe("access_requested");
    expect(new Set(recovered.agent?.steps.map((step) => step.tool))).toEqual(new Set(["get_case_state", "request_access", "finish"]));
  });

  it("files Aisha's permitted role requests once and shows receipts with named approvers", async () => {
    const opened = await (await POST(request())).json() as { run_id: string; case: { id: string } };
    const response = await POST(request({
      case_id: opened.case.id,
      run_id: opened.run_id,
      action: "access_request",
    }));
    expect(response.status).toBe(200);
    const first = await response.json() as {
      run_id: string;
      onboarding: { access: Array<{ system: string; request_id: string | null; request_status: string; approver_name: string }> };
      agent: { trigger: string; stop_reason: string; next_action: string };
      trace: Array<{ kind: string; summary: string }>;
    };
    expect(first.agent).toMatchObject({ trigger: "access_requested", stop_reason: "finished" });
    expect(first.onboarding.access).toHaveLength(6);
    expect(first.onboarding.access.every((row) => row.request_id?.startsWith("REQ-") && row.request_status === "requested")).toBe(true);
    expect(first.onboarding.access.find((row) => row.system === "salesforce")?.approver_name).toBe("Chloe Bennett");
    expect(first.trace.some((entry) => entry.kind === "tool.identity.request_access" && entry.summary.includes("Access remains ungranted"))).toBe(true);

    const retry = await (await POST(request({
      case_id: opened.case.id,
      run_id: first.run_id,
      action: "access_request",
    }))).json() as typeof first;
    expect(retry.onboarding.access.map((row) => row.request_id)).toEqual(first.onboarding.access.map((row) => row.request_id));
  });

  it("keeps Priya's role requests separate from Aisha's", async () => {
    const aisha = await (await POST(request())).json() as { run_id: string; case: { id: string } };
    await POST(request({ case_id: aisha.case.id, run_id: aisha.run_id, action: "access_request" }));

    const priya = await (await POST(request({ action: "open_case", joiner_id: "J-001" }))).json() as { run_id: string; case: { id: string } };
    const requested = await (await POST(request({ case_id: priya.case.id, run_id: priya.run_id, action: "access_request" }))).json() as {
      onboarding: { access: Array<{ system: string; request_id: string | null; approver_name: string }> };
    };
    expect(requested.onboarding.access).toHaveLength(5);
    expect(requested.onboarding.access.map((row) => row.system)).toContain("github");
    expect(requested.onboarding.access.map((row) => row.system)).not.toContain("salesforce");
    expect(requested.onboarding.access.find((row) => row.system === "github")?.approver_name).toBe("Rachel Adeyemi");
  });

  it("keeps successful receipts when one request fails and files only the missing request on retry", async () => {
    setSimulatedAccessFailure("salesforce");
    const opened = await (await POST(request())).json() as { run_id: string; case: { id: string } };
    const first = await (await POST(request({ case_id: opened.case.id, run_id: opened.run_id, action: "access_request" }))).json() as {
      run_id: string;
      agent: { next_action: string; tool_calls: number };
      onboarding: { access: Array<{ system: string; request_id: string | null }> };
    };
    const successfulIds = first.onboarding.access.filter((row) => row.system !== "salesforce").map((row) => row.request_id);
    expect(successfulIds.every(Boolean)).toBe(true);
    expect(first.onboarding.access.find((row) => row.system === "salesforce")?.request_id).toBeNull();
    expect(first.agent.next_action).toContain("5 of 6");

    setSimulatedAccessFailure("salesforce", false);
    setSimulatedAccessFailure("slack");
    const retried = await (await POST(request({ case_id: opened.case.id, run_id: first.run_id, action: "access_request" }))).json() as typeof first;
    expect(retried.onboarding.access.filter((row) => row.system !== "salesforce").map((row) => row.request_id)).toEqual(successfulIds);
    expect(retried.onboarding.access.find((row) => row.system === "salesforce")?.request_id).toMatch(/^REQ-/);
    expect(retried.agent.next_action).toContain("6 access requests");
    expect(retried.agent.tool_calls).toBe(3);
  });

  it("refuses off-matrix systems, elevated levels and wrong approvers without creating a grant", async () => {
    const preparation = await prepareDemo(undefined, "mock", "J-001");
    const runtime = createAgentToolRuntime({ case: preparation.case, joiner: preparation.joiner, trigger: "access_requested", now: "2026-09-30T09:00:00Z" });
    for (const input of [
      { system: "salesforce", level: "standard", approver: "manager" },
      { system: "github", level: "elevated", approver: "manager" },
      { system: "github", level: "standard", approver: "it" },
    ]) {
      const result = await runtime.dispatch("request_access", input);
      expect(result.status).toBe("denied");
    }
  });
});
