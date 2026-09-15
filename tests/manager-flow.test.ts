import { beforeEach, describe, expect, it } from "vitest";
import { POST, resetDemoRouteState } from "@/app/api/demo/route";
import { recordManagerResponse, prepareManagerCoordination, prepareDemo, resolveManagerApproval, retryAgent } from "@/lib/demo-flow";
import { sent } from "@/lib/connectors/simulated/messaging";
import { findAction } from "@/lib/connectors/registry";
import { failed } from "@/lib/connectors/interface";
import { resetDemoState } from "@/lib/store/demo-state";
import { createAgentToolRuntime } from "@/lib/agent/tools";

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

type ManagerPayload = {
  run_id: string;
  next_action: string;
  trace: Array<{ kind: string; summary: string }>;
  case: { id: string };
  draft: { id: string; status: string } | null;
  manager_coordination: {
    request: { id: string; status: string; manager_name: string; start_date: string; send_error?: string; arrival_time?: string; meeting_place?: string; first_day_outline?: string[]; items_to_bring?: string[] } | null;
    draft: { id: string; subject: string; body: string; status: string; supersedes_draft_id?: string } | null;
  };
  onboarding: { first_day: { arrival_time: string | null; office_address: string | null; items_to_bring: string[] | null; outline: string[] | null; confirmed_plan_id: string | null } };
};

describe("manager coordination", () => {
  beforeEach(() => {
    resetDemoState();
    resetDemoRouteState();
    process.env.DEMO_MODE = "mock";
  });

  it("prepares, edits, exactly approves, receives and confirms a first-day plan", async () => {
    const opened = await (await POST(request())).json() as ManagerPayload;
    const prepared = await (await POST(request({ case_id: opened.case.id, run_id: opened.run_id, action: "manager_prepare" }))).json() as ManagerPayload;
    expect(prepared.manager_coordination.request).toMatchObject({ status: "pending_approval", manager_name: "Chloe Bennett" });
    expect(prepared.next_action).toContain("Approve or reject the exact first-day plan request to Chloe Bennett");
    expect(prepared.manager_coordination.draft?.body).toContain("arrival time");
    expect(prepared.draft?.id).toBe(opened.draft?.id);

    const originalDraft = prepared.manager_coordination.draft!;
    const edited = await (await POST(request({
      case_id: opened.case.id,
      run_id: prepared.run_id,
      action: "manager_edit",
      request_id: prepared.manager_coordination.request!.id,
      draft_id: originalDraft.id,
      subject: "First-day details for Aisha",
      body: "Hi Chloe, please confirm Aisha's arrival time, meeting place, first-day outline and anything to bring for the 12 October start.",
    }))).json() as ManagerPayload;
    expect(edited.manager_coordination.draft?.id).not.toBe(originalDraft.id);
    expect(edited.manager_coordination.draft?.supersedes_draft_id).toBe(originalDraft.id);

    const stale = await POST(request({ case_id: opened.case.id, run_id: prepared.run_id, action: "manager_decision", request_id: prepared.manager_coordination.request!.id, draft_id: originalDraft.id, decision: "approve" }));
    expect(stale.status).toBe(409);

    const approved = await (await POST(request({ case_id: opened.case.id, run_id: edited.run_id, action: "manager_decision", request_id: edited.manager_coordination.request!.id, draft_id: edited.manager_coordination.draft!.id, decision: "approve" }))).json() as ManagerPayload;
    expect(approved.manager_coordination.request?.status).toBe("awaiting_response");
    expect(approved.next_action).toContain("Wait for Chloe Bennett's first-day plan response");
    expect(sent.at(-1)?.draft_id).toBe(edited.manager_coordination.draft?.id);

    const responded = await (await POST(request({ case_id: opened.case.id, run_id: approved.run_id, action: "manager_response", request_id: approved.manager_coordination.request!.id }))).json() as ManagerPayload;
    expect(responded.manager_coordination.request).toMatchObject({ status: "responded", arrival_time: "09:30", meeting_place: "London office reception" });
    expect(responded.next_action).toContain("Confirm the manager's first-day plan as People");
    expect(responded.onboarding.first_day.arrival_time).toBeNull();

    const confirmed = await (await POST(request({ case_id: opened.case.id, run_id: responded.run_id, action: "manager_confirm", request_id: responded.manager_coordination.request!.id }))).json() as ManagerPayload;
    expect(confirmed.manager_coordination.request?.status).toBe("confirmed");
    expect(confirmed.next_action).not.toContain("first-day plan request to Chloe Bennett");
    expect(confirmed.onboarding.first_day).toMatchObject({ arrival_time: "09:30", office_address: "London office reception", confirmed_plan_id: responded.manager_coordination.request!.id });
    const answer = await (await POST(request({ case_id: opened.case.id, run_id: confirmed.run_id, action: "ask", question: "What time should I arrive on my first day?" }))).json() as { answer: { answer: string } };
    expect(answer.answer.answer).toContain("arrive at 09:30");
    expect(answer.answer.answer).toContain("London office reception");
    const status = await (await POST(request({ case_id: opened.case.id, run_id: confirmed.run_id, action: "ask", question: "What's left before day one?" }))).json() as { answer: { answer: string } };
    expect(status.answer.answer).not.toContain("Approve the first-day plan request");
    expect(status.answer.answer).not.toContain("Approve or reject the exact first-day plan request");

    const equipmentApproved = await (await POST(request({ case_id: opened.case.id, run_id: confirmed.run_id, decision: "approve" }))).json() as ManagerPayload;
    expect(equipmentApproved.next_action).not.toContain("Approve or reject the equipment nudge");
    expect(equipmentApproved.next_action).not.toContain("first-day plan request to Chloe Bennett");
  });

  it("does not duplicate an active request and refuses a response before send", async () => {
    const opened = await (await POST(request())).json() as ManagerPayload;
    const prepared = await (await POST(request({ case_id: opened.case.id, run_id: opened.run_id, action: "manager_prepare" }))).json() as ManagerPayload;
    const duplicate = await (await POST(request({ case_id: opened.case.id, run_id: prepared.run_id, action: "manager_prepare" }))).json() as ManagerPayload;
    expect(duplicate.manager_coordination.request?.id).toBe(prepared.manager_coordination.request?.id);
    const early = await POST(request({ case_id: opened.case.id, run_id: prepared.run_id, action: "manager_response", request_id: prepared.manager_coordination.request!.id }));
    expect(early.status).toBe(409);
    expect(sent).toHaveLength(0);

    const rejected = await (await POST(request({ case_id: opened.case.id, run_id: prepared.run_id, action: "manager_decision", request_id: prepared.manager_coordination.request!.id, draft_id: prepared.manager_coordination.draft!.id, decision: "reject" }))).json() as ManagerPayload;
    expect(rejected.manager_coordination.request?.status).toBe("rejected");
    expect(rejected.next_action).toContain("Prepare a new first-day plan request to Chloe Bennett");
  });

  it("retries failed manager preparation through the manager workflow and creates one matching request", async () => {
    const failedPreparation = await prepareDemo(undefined, "mock");
    failedPreparation.agent = {
      ...failedPreparation.agent!,
      trigger: "manager_coordination",
      stop_reason: "guard",
      next_action: "Run assistant again.",
      proposals: [],
    };
    failedPreparation.draft_unavailable = { message: "Assistant unavailable (guard)." };

    const recovered = await retryAgent(failedPreparation, "mock");
    const managerDrafts = recovered.case.drafts.filter((draft) => draft.workstream === "manager" && draft.status === "pending");
    expect(recovered.agent?.trigger).toBe("manager_coordination");
    expect(recovered.agent?.stop_reason).toBe("finished");
    expect(managerDrafts).toHaveLength(1);
    expect(recovered.case.manager_plans).toHaveLength(1);
    expect(recovered.case.manager_plans?.[0]).toMatchObject({ status: "pending_approval", draft_id: managerDrafts[0].id });

    const repeated = await prepareManagerCoordination(recovered, "mock");
    expect(repeated.case.drafts.filter((draft) => draft.workstream === "manager" && draft.status === "pending")).toHaveLength(1);
    expect(repeated.case.manager_plans).toHaveLength(1);
  });

  it("preserves approval and retries the same draft after returned and ambiguous send failures", async () => {
    const slack = findAction("slack.send_message");
    if (!slack) throw new Error("Slack connector missing");
    const originalRun = slack.action.run;
    try {
      const opened = await (await POST(request())).json() as ManagerPayload;
      const prepared = await (await POST(request({ case_id: opened.case.id, run_id: opened.run_id, action: "manager_prepare" }))).json() as ManagerPayload;
      slack.action.run = async () => failed("Temporary Slack failure", true);
      const failedSend = await (await POST(request({ case_id: opened.case.id, run_id: prepared.run_id, action: "manager_decision", request_id: prepared.manager_coordination.request!.id, draft_id: prepared.manager_coordination.draft!.id, decision: "approve" }))).json() as ManagerPayload;
      expect(failedSend.manager_coordination.request).toMatchObject({ status: "send_failed", send_error: "Temporary Slack failure" });
      expect(failedSend.manager_coordination.draft?.status).toBe("approved");
      expect(failedSend.next_action).toContain("Retry delivery of the approved first-day plan request");

      slack.action.run = originalRun;
      const retried = await (await POST(request({ case_id: opened.case.id, run_id: failedSend.run_id, action: "manager_decision", request_id: failedSend.manager_coordination.request!.id, draft_id: failedSend.manager_coordination.draft!.id, decision: "approve" }))).json() as ManagerPayload;
      expect(retried.manager_coordination.request?.status).toBe("awaiting_response");
      expect(sent).toHaveLength(1);
      expect(retried.trace.filter((entry) => entry.kind === "manager.draft.approved")).toHaveLength(1);

      resetDemoState();
      resetDemoRouteState();
      const reopened = await (await POST(request())).json() as ManagerPayload;
      const preparedAgain = await (await POST(request({ case_id: reopened.case.id, run_id: reopened.run_id, action: "manager_prepare" }))).json() as ManagerPayload;
      let firstAttempt = true;
      slack.action.run = async (args) => {
        const result = await originalRun(args);
        if (firstAttempt) {
          firstAttempt = false;
          throw new Error("Timeout after delivery");
        }
        return result;
      };
      const ambiguous = await (await POST(request({ case_id: reopened.case.id, run_id: preparedAgain.run_id, action: "manager_decision", request_id: preparedAgain.manager_coordination.request!.id, draft_id: preparedAgain.manager_coordination.draft!.id, decision: "approve" }))).json() as ManagerPayload;
      expect(ambiguous.manager_coordination.request?.status).toBe("send_failed");
      expect(sent).toHaveLength(1);
      const deduplicated = await (await POST(request({ case_id: reopened.case.id, run_id: ambiguous.run_id, action: "manager_decision", request_id: ambiguous.manager_coordination.request!.id, draft_id: ambiguous.manager_coordination.draft!.id, decision: "approve" }))).json() as ManagerPayload;
      expect(deduplicated.manager_coordination.request?.status).toBe("awaiting_response");
      expect(sent).toHaveLength(1);
      expect(deduplicated.trace.at(-1)?.summary).toContain("duplicate suppressed");
    } finally {
      slack.action.run = originalRun;
    }
  });

  it("refuses a manager-workflow proposal to an unrelated task owner", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const originalDraftIds = preparation.case.drafts.map((draft) => draft.id);
    const workingCase = structuredClone(preparation.case);
    const runtime = createAgentToolRuntime({ case: workingCase, joiner: preparation.joiner, trigger: "manager_coordination", now: "2026-09-30T09:00:00Z" });
    const result = await runtime.dispatch("propose_message", {
      kind: "nudge",
      to: "it-1",
      subject: "First-day plan",
      body: "Please confirm the first-day plan for 2026-10-12.",
      reason: "Manager plan is open.",
      evidence: ["2026-10-12"],
    });
    expect(result.status).toBe("error");
    expect(result.summary).toContain("manager-plan task owner");
    expect(runtime.state.proposals).toHaveLength(0);
    expect(workingCase.drafts.map((draft) => draft.id)).toEqual(originalDraftIds);
  });

  it("rejects incomplete responses and invalidates a confirmed plan after a date change", async () => {
    const base = await prepareDemo(undefined, "mock");
    const prepared = await prepareManagerCoordination(base, "mock");
    const managerRequest = prepared.case.manager_plans?.at(-1);
    expect(managerRequest).toBeDefined();
    if (!managerRequest) throw new Error("Expected a manager request");
    const approvedDirect = await resolveManagerApproval(prepared, managerRequest.id, managerRequest.draft_id, "approve");
    expect(() => recordManagerResponse(approvedDirect, managerRequest.id, {
      arrival_time: "09:30",
      meeting_place: "",
      first_day_outline: [],
      items_to_bring: [],
    })).toThrow("must include");

    resetDemoState();
    resetDemoRouteState();

    const opened = await (await POST(request())).json() as ManagerPayload;
    const manager = await (await POST(request({ case_id: opened.case.id, run_id: opened.run_id, action: "manager_prepare" }))).json() as ManagerPayload;
    const approved = await (await POST(request({ case_id: opened.case.id, run_id: manager.run_id, action: "manager_decision", request_id: manager.manager_coordination.request!.id, draft_id: manager.manager_coordination.draft!.id, decision: "approve" }))).json() as ManagerPayload;
    const responded = await (await POST(request({ case_id: opened.case.id, run_id: approved.run_id, action: "manager_response", request_id: approved.manager_coordination.request!.id }))).json() as ManagerPayload;
    const confirmed = await (await POST(request({ case_id: opened.case.id, run_id: responded.run_id, action: "manager_confirm", request_id: responded.manager_coordination.request!.id }))).json() as ManagerPayload;
    const moved = await (await POST(request({ case_id: opened.case.id, run_id: confirmed.run_id, action: "start_date_change", start_date: "2026-10-19" }))).json() as ManagerPayload;
    expect(moved.manager_coordination.request?.status).toBe("superseded");
    expect(moved.next_action).toContain("Prepare a fresh first-day plan request to Chloe Bennett");
    expect(moved.onboarding.first_day.confirmed_plan_id).toBeNull();
  });
});
