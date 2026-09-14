import { describe, expect, it } from "vitest";
import { changeDemoStartDate, editDemoEquipmentDraft, prepareBuddyRequest, prepareDemo, recordBuddyResponse, resolveBuddyApproval, resolveDemoApproval, runDemo, simulateBuddyAvailabilityChange } from "@/lib/demo-flow";
import { sent, slack } from "@/lib/connectors/simulated/messaging";

describe("single end-to-end demonstration", () => {
  it("runs event to plan to approved send with a trace", async () => {
    const run = await runDemo();

    expect(run.case.id).toBe("CASE-J-004");
    expect(run.equipment.status).toBe("warning");
    expect(run.draft.status).toBe("approved");
    expect(run.draft.body).toContain("loaner or earlier delivery");
    expect(run.beforeApproval.status).toBe("denied");
    expect(run.approved).toBe(true);
    expect(run.afterApproval.status).toBe("ok");
    expect(run.retry.summary).toContain("duplicate suppressed");
    expect(run.trace.map((step) => step.kind)).toEqual(expect.arrayContaining([
      "event.received",
      "plan.built",
      "tool.equipment.order",
      "draft.created",
      "send.refused",
      "draft.approved",
      "send.completed",
      "send.retried",
    ]));
  });

  it("pauses for a real reject decision and never sends", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    expect(preparation.draft?.status).toBe("pending");

    const resolution = await resolveDemoApproval(preparation, "reject", "pp-1");

    expect(resolution.draft.status).toBe("rejected");
    expect(resolution.afterApproval.status).toBe("denied");
    expect(resolution.trace.at(-2)?.kind).toBe("draft.rejected");
    expect(resolution.trace.at(-1)?.kind).toBe("send.refused");
  });

  it("rejects a decision from a superseded preparation", async () => {
    const oldPreparation = await prepareDemo(undefined, "mock");
    const currentPreparation = await prepareDemo(undefined, "mock");

    expect(currentPreparation.run_id).not.toBe(oldPreparation.run_id);
    expect(currentPreparation.draft?.id).not.toBe(oldPreparation.draft?.id);
    await expect(resolveDemoApproval(oldPreparation, "approve", "pp-1")).rejects.toThrow("could not be recorded");
    expect(currentPreparation.draft?.status).toBe("pending");

    const resolution = await resolveDemoApproval(currentPreparation, "approve", "pp-1");
    expect(resolution.afterApproval.status).toBe("ok");
  });

  it("projects current evidence and recalculates the same case after a start-date change", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const oldDraftId = preparation.draft?.id;

    expect(preparation.facts.start_date).toBe("2026-10-12");
    expect(preparation.facts.equipment_eta).toBe("2026-10-16");
    expect(preparation.facts.gap_days).toBe(4);
    expect(preparation.facts.equipment_late).toBe(true);
    expect(preparation.facts.equipment_owner_name).toBe("Nadia Hussain");
    expect(preparation.facts.policy_quote).toContain("five working days");

    const updated = await changeDemoStartDate(preparation, "2026-10-19", "mock");

    expect(updated.run_id).not.toBe(preparation.run_id);
    expect(updated.case.id).toBe(preparation.case.id);
    expect(updated.joiner.start_date).toBe("2026-10-19");
    expect(updated.facts.equipment_late).toBe(false);
    expect(updated.facts.gap_days).toBe(-3);
    expect(updated.draft).toBeNull();
    expect(updated.date_change).toMatchObject({
      previous_start_date: "2026-10-12",
      new_start_date: "2026-10-19",
      risk_before: true,
      risk_after: false,
    });
    expect(updated.date_change?.deadlines_changed).toBeGreaterThan(0);
    expect(updated.case.drafts.find((draft) => draft.id === oldDraftId)?.status).toBe("rejected");
    await expect(resolveDemoApproval(preparation, "approve", "pp-1")).rejects.toThrow("could not be recorded");

    const riskReturned = await changeDemoStartDate(updated, "2026-10-09", "mock");
    expect(riskReturned.case.id).toBe("CASE-J-004");
    expect(riskReturned.facts.equipment_late).toBe(true);
    expect(riskReturned.draft?.id).toBeDefined();
    expect(riskReturned.draft?.id).not.toBe(oldDraftId);
  });

  it("keeps the updated case recoverable when regeneration fails", async () => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const preparation = await prepareDemo(undefined, "mock");
      const failed = await changeDemoStartDate(preparation, "2026-10-09", "live");

      expect(failed.case.start_date).toBe("2026-10-09");
      expect(failed.joiner.start_date).toBe("2026-10-09");
      expect(failed.facts.start_date).toBe("2026-10-09");
      expect(failed.facts.equipment_late).toBe(true);
      expect(failed.draft).toBeNull();
      expect(failed.draft_unavailable?.message).toContain("case and dates are current");
      expect(failed.trace.at(-1)?.kind).toBe("agent.unavailable");
      expect(failed.case.drafts[0]?.status).toBe("rejected");
      await expect(resolveDemoApproval(failed, "approve", "pp-1")).rejects.toThrow("no current draft");

      const retriedSameDate = await changeDemoStartDate(failed, "2026-10-09", "mock");
      expect(retriedSameDate.case.id).toBe("CASE-J-004");
      expect(retriedSameDate.facts.start_date).toBe("2026-10-09");
      expect(retriedSameDate.draft?.status).toBe("pending");
      expect(retriedSameDate.draft_unavailable).toBeUndefined();

      const changedAgain = await changeDemoStartDate(failed, "2026-10-19", "mock");
      expect(changedAgain.facts.equipment_late).toBe(false);
      expect(changedAgain.draft).toBeNull();
      expect(changedAgain.draft_unavailable).toBeUndefined();
    } finally {
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  });

  it("creates an exact pending People revision without sending and suppresses its duplicate retry", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const oldDraftId = preparation.draft?.id;
    const edited = await editDemoEquipmentDraft(
      preparation,
      oldDraftId,
      "Equipment delivery needs a plan",
      "Hi Nadia, please arrange a loaner or earlier delivery for Aisha before her first day.",
    );

    expect(edited.run_id).not.toBe(preparation.run_id);
    expect(edited.draft?.id).not.toBe(oldDraftId);
    expect(edited.draft).toMatchObject({
      subject: "Equipment delivery needs a plan",
      body: "Hi Nadia, please arrange a loaner or earlier delivery for Aisha before her first day.",
      status: "pending",
      edited_by: "pp-1",
      revision: 1,
      supersedes_draft_id: oldDraftId,
    });
    expect(edited.beforeApproval?.status).toBe("denied");
    expect(sent).toHaveLength(0);
    expect(edited.case.drafts.find((draft) => draft.id === oldDraftId)?.status).toBe("rejected");
    await expect(resolveDemoApproval(preparation, "approve", "pp-1")).rejects.toThrow("could not be recorded");

    const resolution = await resolveDemoApproval(edited, "approve", "pp-1");
    expect(resolution.draft.body).toContain("loaner or earlier delivery");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.draft_id).toBe(resolution.draft.id);
    const duplicate = await slack.actions.send_message.run({ draft_id: resolution.draft.id, now: "2026-09-30T09:00:00Z" });
    expect(duplicate.summary).toContain("duplicate suppressed");
    expect(sent).toHaveLength(1);
  });

  it("leaves the current pending draft intact for unchanged or invalid edits", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const currentDraftId = preparation.draft?.id;
    const unchanged = await editDemoEquipmentDraft(preparation, currentDraftId, preparation.draft?.subject, preparation.draft?.body);

    expect(unchanged).toBe(preparation);
    expect(unchanged.draft?.id).toBe(currentDraftId);
    expect(unchanged.draft?.status).toBe("pending");

    await expect(editDemoEquipmentDraft(preparation, currentDraftId, "", "valid body")).rejects.toThrow("cannot be empty");
    await expect(editDemoEquipmentDraft(preparation, currentDraftId, "valid subject", "x".repeat(701))).rejects.toThrow("700 characters or fewer");
    await expect(editDemoEquipmentDraft(preparation, currentDraftId, 42, "valid body")).rejects.toThrow("must be a string");
    expect(preparation.draft?.id).toBe(currentDraftId);
    expect(preparation.draft?.status).toBe("pending");
    expect(preparation.case.drafts.find((draft) => draft.id === currentDraftId)?.status).toBe("pending");
  });

  it("preserves an active buddy request across an equipment edit", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const withBuddy = await prepareBuddyRequest(preparation, "b-06");
    const edited = await editDemoEquipmentDraft(withBuddy, withBuddy.draft?.id, "Edited equipment subject", "Edited equipment body");

    expect(edited.buddy.request?.id).toBe(withBuddy.buddy.request?.id);
    expect(edited.buddy.request?.status).toBe("pending_approval");
    expect(edited.buddy.draft?.id).toBe(withBuddy.buddy.draft?.id);
  });

  it("supersedes a saved equipment revision when the start date changes", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const edited = await editDemoEquipmentDraft(preparation, preparation.draft?.id, "Edited subject", "Edited body");
    const moved = await changeDemoStartDate(edited, "2026-10-19", "mock");

    expect(moved.date_change?.superseded_draft_id).toBe(edited.draft?.id);
    expect(moved.draft).toBeNull();
    expect(edited.case.drafts.find((draft) => draft.id === edited.draft?.id)?.status).toBe("rejected");
    await expect(resolveDemoApproval(edited, "approve", "pp-1")).rejects.toThrow("could not be recorded");
  });

  it("runs the start-date trigger against the recalculated case", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const updated = await changeDemoStartDate(preparation, "2026-10-09", "mock");

    expect(updated.agent?.trigger).toBe("start_date_changed");
    expect(updated.agent?.stop_reason).toBe("finished");
    expect(updated.agent?.next_action).toBe("Start date moved to 2026-10-09. Approve the re-proposed buddy request to Rob Fletcher. Approve the equipment nudge to Nadia Hussain as well.");
    expect(updated.draft?.status).toBe("pending");
    expect(updated.facts.equipment_late).toBe(true);
  });

  it("runs the buddy-declined trigger and prepares a replacement request", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const request = preparation.buddy.request!;
    const approved = await resolveBuddyApproval(preparation, request.id, preparation.buddy.draft!.id, "approve");
    const declined = await recordBuddyResponse(approved.preparation, request.id, "declined");

    expect(declined.preparation.agent?.trigger).toBe("buddy_declined");
    expect(declined.preparation.agent?.stop_reason).toBe("finished");
    expect(declined.preparation.agent?.next_action).toBe("Approve the replacement buddy request to Amara Osei; Ewan Grant declined.");
    expect(declined.preparation.case.buddy_requests.find((candidate) => candidate.id === request.id)?.status).toBe("declined");
    expect(declined.preparation.buddy.request?.candidate_id).toBe("b-01");
    expect(declined.preparation.buddy.request?.status).toBe("pending_approval");
  });

  it("runs the availability-changed trigger and proposes from refreshed facts", async () => {
    const preparation = await prepareDemo(undefined, "mock");
    const changed = await simulateBuddyAvailabilityChange(preparation, "b-06");

    expect(changed.agent?.trigger).toBe("availability_changed");
    expect(changed.agent?.stop_reason).toBe("finished");
    expect(changed.agent?.next_action).toBe("Approve the refreshed buddy request to Amara Osei after availability changed.");
    expect(changed.buddy.request?.candidate_id).toBe("b-01");
    expect(changed.buddy.request?.status).toBe("pending_approval");
  });
});
