import { describe, expect, it, beforeEach } from "vitest";
import { BUDDY_CALENDARS } from "@/data/buddy-calendars";
import { findAction } from "@/lib/connectors/registry";
import { sent } from "@/lib/connectors/simulated/messaging";
import { setSimulatedBuddyCalendar } from "@/lib/connectors/simulated/buddy-directory";
import {
  prepareBuddyRequest,
  prepareDemo,
  resolveBuddyApproval,
} from "@/lib/demo-flow";
import { resetDemoState } from "@/lib/store/demo-state";
import { POST } from "@/app/api/demo/route";

function request(body: Record<string, string> = {}) {
  return new Request("http://localhost/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

type BuddyRequestView = {
  id: string;
  draft_id: string;
  candidate_id: string;
  candidate_name: string;
  status: string;
  response?: string;
};

type BuddyPayload = {
  run_id: string;
  case: {
    id: string;
    buddy_id: string | null;
    buddy_task_status: string | null;
    buddy_task_done_by: string | null;
  };
  draft: { id: string; status: string } | null;
  buddy: {
    request: BuddyRequestView | null;
    draft: { id: string; status: string } | null;
    before_approval: { status: string; summary: string } | null;
    after_approval?: { status: string; summary: string };
    availability: {
      recommendation: { candidate_id: string; candidate_name: string } | null;
    };
  };
  date_change?: { superseded_buddy_request_id?: string };
  after_approval?: { status: string; summary: string };
};

describe("checkpoint-B buddy flow", () => {
  beforeEach(() => {
    resetDemoState();
  });

  it("keeps equipment and buddy decisions on the same case, with People confirmation last", async () => {
    const prepared = await (await POST(request())).json() as BuddyPayload;
    const buddyPrepared = await (await POST(request({
      run_id: prepared.run_id,
      action: "buddy_prepare",
    }))).json() as BuddyPayload;
    const buddyRequest = buddyPrepared.buddy.request!;

    expect(buddyPrepared.case.id).toBe("CASE-J-004");
    expect(buddyPrepared.draft?.status).toBe("pending");
    expect(buddyRequest.status).toBe("pending_approval");
    expect(buddyPrepared.buddy.draft?.status).toBe("pending");

    const buddyApproved = await (await POST(request({
      run_id: buddyPrepared.run_id,
      action: "buddy_decision",
      request_id: buddyRequest.id,
      draft_id: buddyRequest.draft_id,
      decision: "approve",
    }))).json() as BuddyPayload;

    expect(buddyApproved.case.id).toBe(buddyPrepared.case.id);
    expect(buddyApproved.buddy.request?.status).toBe("awaiting_acceptance");
    expect(buddyApproved.buddy.after_approval?.status).toBe("ok");
    expect(buddyApproved.draft?.status).toBe("pending");
    expect(buddyApproved.case.buddy_id).toBeNull();

    const prematureConfirmation = await POST(request({
      run_id: buddyApproved.run_id,
      action: "buddy_confirm",
      request_id: buddyRequest.id,
    }));
    expect(prematureConfirmation.status).toBe(409);

    const accepted = await (await POST(request({
      run_id: buddyApproved.run_id,
      action: "buddy_response",
      request_id: buddyRequest.id,
      response: "accepted",
    }))).json() as BuddyPayload;

    expect(accepted.buddy.request?.status).toBe("accepted");
    expect(accepted.case.buddy_id).toBeNull();
    expect(accepted.case.buddy_task_status).toBe("open");

    const confirmed = await (await POST(request({
      run_id: accepted.run_id,
      action: "buddy_confirm",
      request_id: buddyRequest.id,
    }))).json() as BuddyPayload;

    expect(confirmed.buddy.request?.status).toBe("confirmed");
    expect(confirmed.case.buddy_id).toBe(buddyRequest.candidate_id);
    expect(confirmed.case.buddy_task_status).toBe("done");
    expect(confirmed.case.buddy_task_done_by).toBe("pp-1");

    const equipmentApproved = await (await POST(request({
      run_id: confirmed.run_id,
      decision: "approve",
    }))).json() as BuddyPayload;

    expect(equipmentApproved.case.id).toBe("CASE-J-004");
    expect(equipmentApproved.after_approval?.status).toBe("ok");
    expect(equipmentApproved.case.buddy_id).toBe(buddyRequest.candidate_id);
    expect(equipmentApproved.case.buddy_task_status).toBe("done");
  });

  it("rejects an exact buddy draft without sending and leaves the same case usable", async () => {
    const prepared = await (await POST(request())).json() as BuddyPayload;
    const buddyPrepared = await (await POST(request({
      run_id: prepared.run_id,
      action: "buddy_prepare",
    }))).json() as BuddyPayload;
    const buddyRequest = buddyPrepared.buddy.request!;

    const rejected = await (await POST(request({
      run_id: buddyPrepared.run_id,
      action: "buddy_decision",
      request_id: buddyRequest.id,
      draft_id: buddyRequest.draft_id,
      decision: "reject",
    }))).json() as BuddyPayload;

    expect(rejected.buddy.request?.status).toBe("rejected");
    expect(rejected.buddy.after_approval?.status).toBe("denied");
    expect(rejected.case.buddy_id).toBeNull();
    expect(rejected.draft?.status).toBe("pending");
    expect(sent).toHaveLength(0);
  });

  it("keeps an equipment decision while a declined buddy request offers recovery without auto-sending", async () => {
    const prepared = await (await POST(request())).json() as BuddyPayload;
    const equipmentApproved = await (await POST(request({
      run_id: prepared.run_id,
      decision: "approve",
    }))).json() as BuddyPayload;
    expect(equipmentApproved.after_approval?.status).toBe("ok");

    const buddyPrepared = await (await POST(request({
      run_id: equipmentApproved.run_id,
      action: "buddy_prepare",
    }))).json() as BuddyPayload;
    const firstRequest = buddyPrepared.buddy.request!;
    const buddyApproved = await (await POST(request({
      run_id: buddyPrepared.run_id,
      action: "buddy_decision",
      request_id: firstRequest.id,
      draft_id: firstRequest.draft_id,
      decision: "approve",
    }))).json() as BuddyPayload;

    const declined = await (await POST(request({
      run_id: buddyApproved.run_id,
      action: "buddy_response",
      request_id: firstRequest.id,
      response: "declined",
    }))).json() as BuddyPayload;

    expect(declined.buddy.request?.status).toBe("declined");
    expect(declined.buddy.availability.recommendation?.candidate_id).not.toBe(firstRequest.candidate_id);
    expect(declined.buddy.availability.recommendation?.candidate_id).toBe("b-01");
    expect(declined.case.buddy_id).toBeNull();
    expect(sent).toHaveLength(2);

    const replacement = await (await POST(request({
      run_id: declined.run_id,
      action: "buddy_prepare",
    }))).json() as BuddyPayload;

    expect(replacement.buddy.request?.candidate_id).toBe("b-01");
    expect(replacement.buddy.request?.id).not.toBe(firstRequest.id);
    expect(replacement.buddy.before_approval?.status).toBe("denied");
    expect(sent).toHaveLength(2);
  });

  it("rejects stale or mismatched buddy decisions and suppresses a repeated send", async () => {
    const prepared = await (await POST(request())).json() as BuddyPayload;
    const buddyPrepared = await (await POST(request({
      run_id: prepared.run_id,
      action: "buddy_prepare",
    }))).json() as BuddyPayload;
    const buddyRequest = buddyPrepared.buddy.request!;

    const wrongDraft = await POST(request({
      run_id: buddyPrepared.run_id,
      action: "buddy_decision",
      request_id: buddyRequest.id,
      draft_id: "DRAFT-BUDDY-old",
      decision: "approve",
    }));
    expect(wrongDraft.status).toBe(409);

    const approved = await (await POST(request({
      run_id: buddyPrepared.run_id,
      action: "buddy_decision",
      request_id: buddyRequest.id,
      draft_id: buddyRequest.draft_id,
      decision: "approve",
    }))).json() as BuddyPayload;
    expect(approved.buddy.after_approval?.status).toBe("ok");

    const send = findAction("slack.send_message")!;
    const duplicate = await send.action.run({ draft_id: buddyRequest.draft_id, now: "2026-09-30T09:00:00Z" });
    expect(duplicate.status).toBe("ok");
    expect(duplicate.summary).toContain("duplicate suppressed");
    expect(sent).toHaveLength(1);

    const accepted = await (await POST(request({
      run_id: approved.run_id,
      action: "buddy_response",
      request_id: buddyRequest.id,
      response: "accepted",
    }))).json() as BuddyPayload;

    const staleResponse = await POST(request({
      run_id: approved.run_id,
      action: "buddy_response",
      request_id: buddyRequest.id,
      response: "declined",
    }));
    expect(staleResponse.status).toBe(409);
    expect(accepted.buddy.request?.status).toBe("accepted");
  });

  it("invalidates a pending request when the current availability changes", async () => {
    const prepared = await prepareDemo(undefined, "mock");
    const withRequest = await prepareBuddyRequest(prepared);
    const requestRecord = withRequest.buddy.request!;
    const snapshot = BUDDY_CALENDARS.find((calendar) => calendar.buddy_id === requestRecord.candidate_id)!;
    const fullWeekBusy = [12, 13, 14, 15, 16].map((day) => ({
      start_at: `2026-10-${day}T09:00:00+01:00`,
      end_at: `2026-10-${day}T17:30:00+01:00`,
    }));
    setSimulatedBuddyCalendar({ ...snapshot, busy_intervals: fullWeekBusy });

    const result = await resolveBuddyApproval(
      withRequest,
      requestRecord.id,
      requestRecord.draft_id,
      "approve",
      "pp-1",
    );

    expect(result.conflict).toContain("availability changed");
    expect(result.preparation.buddy.request?.status).toBe("superseded");
    expect(result.preparation.buddy.draft).toBeNull();
    expect(result.preparation.case.drafts.find((draft) => draft.id === requestRecord.draft_id)?.status).toBe("rejected");
    expect(sent).toHaveLength(0);
  });

  it("invalidates a pending buddy request when the start date changes", async () => {
    const prepared = await (await POST(request())).json() as BuddyPayload;
    const buddyPrepared = await (await POST(request({
      run_id: prepared.run_id,
      action: "buddy_prepare",
    }))).json() as BuddyPayload;
    const buddyRequest = buddyPrepared.buddy.request!;

    const changedResponse = await POST(request({
      run_id: buddyPrepared.run_id,
      action: "start_date_change",
      start_date: "2026-10-19",
    }));
    expect(changedResponse.status).toBe(200);
    const changed = await changedResponse.json() as BuddyPayload & { facts: { start_date: string } };

    expect(changed.facts.start_date).toBe("2026-10-19");
    expect(changed.date_change?.superseded_buddy_request_id).toBe(buddyRequest.id);
    expect(changed.buddy.request?.status).toBe("superseded");
    expect(changed.buddy.draft).toBeNull();

    const stale = await POST(request({
      run_id: buddyPrepared.run_id,
      action: "buddy_decision",
      request_id: buddyRequest.id,
      draft_id: buddyRequest.draft_id,
      decision: "approve",
    }));
    expect(stale.status).toBe(409);
  });
});
