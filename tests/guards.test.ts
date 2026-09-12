import { describe, it, expect } from "vitest";
import { authorize } from "@/lib/permissions";
import { signWebhook, verifyWebhook } from "@/lib/connectors/simulated/hris";
import { citeIsVerbatim, searchKb } from "@/lib/connectors/simulated/policy-kb";
import { findAction } from "@/lib/connectors/registry";
import { eligibleBuddies } from "@/lib/policy/buddy";
import { BUDDIES } from "@/data/buddies";
import { joinerById } from "@/data/joiners";

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
    const r = await a.action.run({ draft: { id: "D-1", status: "pending", to: "m-1" }, now: "2026-10-01T00:00:00Z" });
    expect(r.status).toBe("denied");
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
  it("finds nothing for a question the KB does not cover", () => {
    expect(searchKb("can I bring my dog to the office").filter((r) => r.score >= 2)).toHaveLength(0);
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
