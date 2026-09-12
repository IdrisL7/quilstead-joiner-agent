import { beforeEach, describe, it, expect } from "vitest";
import { authorize } from "@/lib/permissions";
import { signWebhook, verifyWebhook } from "@/lib/connectors/simulated/hris";
import { citeIsVerbatim } from "@/lib/connectors/simulated/policy-kb";
import { findAction } from "@/lib/connectors/registry";
import { eligibleBuddies } from "@/lib/policy/buddy";
import { BUDDIES } from "@/data/buddies";
import { joinerById } from "@/data/joiners";
import {
  approveDraft,
  registerDraft,
  resetDraftState,
  sent,
} from "@/lib/connectors/simulated/messaging";
import { accessRequests, resetAccessRequests } from "@/lib/connectors/simulated/identity";
import type { Draft } from "@/lib/types";

beforeEach(() => {
  resetDraftState();
  resetAccessRequests();
});

describe("permission ladder", () => {
  it("prohibits unknown tools by default", () => {
    expect(authorize("payroll.run").mode).toBe("prohibited");
    expect(authorize("payroll.run").matched_rule).toBeNull();
  });
  it("has no grant path", () => {
    expect(authorize("identity.grant_access").mode).toBe("prohibited");
    expect(findAction("identity.grant_access")).toBeUndefined();
    expect(authorize("compliance.mark_complete").mode).toBe("prohibited");
  });
  it("gates every outbound message on approval", () => {
    for (const t of ["slack.send_message", "email.send", "esign.send_pack"]) expect(authorize(t).mode).toBe("approval_required");
  });
});

describe("messaging adapters refuse unapproved drafts", () => {
  it("slack.send_message denies a pending draft", async () => {
    const a = findAction("slack.send_message")!;
    const r = await a.action.run({ draft_id: "D-1", now: "2026-10-01T00:00:00Z" });
    expect(r.status).toBe("denied");
  });

  it("resolves approval from trusted state and binds the sent message", async () => {
    const a = findAction("slack.send_message")!;
    const draft: Draft = {
      id: "D-2",
      case_id: "CASE-J-001",
      kind: "nudge",
      channel: "slack",
      to: "m-1",
      body: "The laptop order is late.",
      status: "pending",
      created_at: "2026-10-01T09:00:00Z",
    };

    const fabricated = await a.action.run({
      draft_id: draft.id,
      draft: { ...draft, status: "approved", decided_by: "made-up-human", to: "attacker" },
      now: "2026-10-01T10:00:00Z",
    });
    expect(fabricated.status).toBe("denied");

    expect(registerDraft(draft)).toBe(true);
    expect(await a.action.run({ draft_id: draft.id, now: "2026-10-01T10:01:00Z" })).toMatchObject({ status: "denied" });
    expect(approveDraft(draft.id, "made-up-human", "2026-10-01T10:01:30Z")).toBe(false);
    expect(approveDraft(draft.id, "m-1", "2026-10-01T10:02:00Z")).toBe(true);
    expect(registerDraft({ ...draft, to: "attacker", body: "Changed after approval" })).toBe(false);

    const email = findAction("email.send")!;
    expect(await email.action.run({ draft_id: draft.id, now: "2026-10-01T10:02:30Z" })).toMatchObject({ status: "denied" });

    const sentResult = await a.action.run({
      draft_id: draft.id,
      channel: "email",
      to: "attacker",
      now: "2026-10-01T10:03:00Z",
    });
    expect(sentResult.status).toBe("ok");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "slack", draft_id: draft.id, to: "m-1" });
    expect(sent[0].content_version).toBeTruthy();

    const retry = await a.action.run({ draft_id: draft.id, now: "2026-10-01T10:04:00Z" });
    expect(retry.status).toBe("ok");
    expect(sent).toHaveLength(1);
  });
});

describe("identity request boundary", () => {
  it("derives access and approver from the joiner's role matrix", async () => {
    const a = findAction("identity.request_access")!;
    const invalid = await a.action.run({
      joiner_id: "J-001",
      system: "payroll",
      level: "superadmin",
      approver: "attacker",
      now: "2026-10-01T10:00:00Z",
    });
    expect(invalid.status).toBe("denied");
    expect(accessRequests).toHaveLength(0);

    const allowed = await a.action.run({
      joiner_id: "J-001",
      system: "github",
      level: "standard",
      approver: "manager",
      now: "2026-10-01T10:01:00Z",
    });
    expect(allowed.status).toBe("ok");
    expect(accessRequests).toHaveLength(1);
    expect(accessRequests[0]).toMatchObject({ joiner_id: "J-001", system: "github", level: "standard", approver: "manager" });

    const duplicate = await a.action.run({
      joiner_id: "J-001",
      system: "github",
      level: "standard",
      approver: "manager",
      now: "2026-10-01T10:02:00Z",
    });
    expect(duplicate.status).toBe("ok");
    expect(accessRequests).toHaveLength(1);
  });
});

describe("webhook signature", () => {
  it("verifies a correctly signed body and rejects a tampered one", () => {
    const body = JSON.stringify({ event_id: "EVT-001" });
    const sig = signWebhook(body, "s3cret");
    expect(verifyWebhook(body, sig, "s3cret")).toBe(true);
    expect(verifyWebhook(body + " ", sig, "s3cret")).toBe(false);
    expect(verifyWebhook(body, sig, "other")).toBe(false);
  });
});

describe("policy KB citation guard", () => {
  it("accepts a verbatim quote and rejects a paraphrase", () => {
    expect(citeIsVerbatim("day-one-schedule", "Office and hybrid joiners arrive at reception at 9:30 on their first day")).toBe(true);
    expect(citeIsVerbatim("day-one-schedule", "Joiners should turn up at reception around half nine")).toBe(false);
  });
  it("abstains through the connector for a question the KB does not cover", async () => {
    const a = findAction("policy_kb.search")!;
    const r = await a.action.run({ query: "Can I bring my dog to the office?" });
    expect(r.status).toBe("warning");
    expect(r.data).toBeUndefined();
    expect(r.next_actions).toContain("Escalate KB_NO_ANSWER");
  });
});

describe("buddy eligibility", () => {
  it("returns nobody for the Munich office joiner", () => {
    expect(eligibleBuddies(joinerById("J-005")!, BUDDIES)).toHaveLength(0);
  });
  it("ranks same office and team first for the London engineer", () => {
    const list = eligibleBuddies(joinerById("J-001")!, BUDDIES);
    expect(list[0].team).toBe("Platform");
    expect(list.every((b) => b.office === "London")).toBe(true);
    expect(list.find((b) => b.id === "b-03")).toBeUndefined(); // two active buddies already
  });
});
