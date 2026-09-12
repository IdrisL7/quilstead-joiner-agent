import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EVENTS } from "@/data/events";
import { DEMO_TRIGGER_PREVIEW } from "@/data/demo-trigger";
import { JOINERS } from "@/data/joiners";
import { ApprovalEmptyState, executionStepsFor, initialExecutionFor, simulationTargetFor, WorkflowTriggerCard } from "@/app/page";

function render(run: { screen_state: "draft_unavailable" | "no_action"; equipment_late: boolean }) {
  return renderToStaticMarkup(createElement(ApprovalEmptyState, {
    run: {
      screen_state: run.screen_state,
      facts: {
        equipment_late: run.equipment_late,
        start_date: "2026-10-09",
        equipment_eta: "2026-10-16",
      },
    },
  }));
}

type TestDraftStatus = "pending" | "approved" | "rejected";

function executionFixture(options: { startDate?: string; equipmentLate?: boolean; draftStatus?: TestDraftStatus; includeDraft?: boolean } = {}) {
  const startDate = options.startDate ?? "2026-10-12";
  const equipmentLate = options.equipmentLate ?? true;
  const includeDraft = options.includeDraft ?? true;
  return {
    case: { id: "CASE-J-004", state: "planned", start_date: startDate, task_count: 14, buddy_id: null, buddy_task_status: "open", buddy_task_done_by: null },
    facts: {
      contract_event_id: "EVT-004",
      contract_signed_at: "2026-09-29T09:20:44Z",
      equipment_task_due_at: "2026-10-06T17:00:00Z",
      equipment_task_title: "Order macbook pro 14",
      equipment_owner_id: "it-1",
      equipment_owner_name: "Nadia Hussain",
      start_date: startDate,
      equipment_eta: "2026-10-16",
      gap_days: equipmentLate ? 4 : -3,
      equipment_late: equipmentLate,
      policy_page_id: "equipment-policy",
      policy_quote: "IT orders equipment within five working days of the contract being signed.",
      approval_required: "Human approval is required before slack.send_message.",
    },
    equipment: { status: equipmentLate ? "warning" : "ok", summary: "Order EQ-0001 backordered; ETA 2026-10-16 is after the SLA.", eta: "2026-10-16" },
    draft: includeDraft ? { id: "DRAFT-1", kind: "nudge", action: "slack.send_message", channel: "slack", recipient: "Nadia Hussain", subject: "Equipment delivery delay", body: "Please arrange a loaner.", status: options.draftStatus ?? "pending" } : null,
    buddy: {
      availability: { start_date: startDate, candidates: [], recommendation: { candidate_id: "b-06", candidate_name: "Ewan Grant", reason: "Available", slots: [] }, escalation: null },
      request: null,
      draft: null,
      before_approval: null,
    },
    trace: [
      { actor: "system", kind: "event.received", summary: "contract.signed for Aisha Okafor (EVT-004)." },
      { actor: "system", kind: "contract.written", summary: "Aisha is compliant, equipped, connected and expected on 2026-10-12." },
      { actor: "system", kind: "plan.built", summary: "14 tasks planned from UK rules for start 2026-10-12." },
      { actor: "agent", kind: "tool.equipment.order", summary: "Order EQ-0001 backordered; ETA 2026-10-16 is after the SLA." },
      { actor: "agent", kind: "tool.buddy_directory.get_availability", summary: "Recommended Ewan Grant from the current first-week calendar snapshot." },
    ],
  } as Parameters<typeof executionStepsFor>[0];
}

describe("approval empty state rendering", () => {
  it("keeps an unavailable draft visibly attached to the remaining equipment risk", () => {
    const html = render({ screen_state: "draft_unavailable", equipment_late: true });

    expect(html).toContain("Draft unavailable. Equipment risk remains");
    expect(html).not.toContain("No message needed");
  });

  it("only renders no message needed after the current facts clear the risk", () => {
    const html = render({ screen_state: "no_action", equipment_late: false });

    expect(html).toContain("No message needed");
    expect(html).not.toContain("Draft unavailable");
  });
});

describe("workflow trigger presentation", () => {
  it("keeps the visible trigger projection aligned with the source fixtures", () => {
    const event = EVENTS.find((candidate) => candidate.event_id === DEMO_TRIGGER_PREVIEW.event_id && candidate.type === DEMO_TRIGGER_PREVIEW.event_type);
    const joiner = JOINERS.find((candidate) => candidate.id === "J-004");

    expect(event).toBeDefined();
    expect(joiner).toBeDefined();
    expect(DEMO_TRIGGER_PREVIEW.occurred_at).toBe(event?.occurred_at);
    expect(DEMO_TRIGGER_PREVIEW.joiner.full_name).toBe(joiner?.full_name);
    expect(DEMO_TRIGGER_PREVIEW.joiner.start_date).toBe(joiner?.start_date);
  });

  it("labels the simulated event and trigger action for the waiting state", () => {
    const html = renderToStaticMarkup(createElement(WorkflowTriggerCard, { busy: false, onTrigger: () => undefined }));

    expect(html).toContain("Workflow trigger");
    expect(html).toContain("Simulated HRIS event");
    expect(html).toContain("contract.signed");
    expect(html).toContain("Simulate contract signed");
  });

  it("derives the initial execution summary from returned trace evidence", () => {
    const steps = executionStepsFor(executionFixture());

    expect(steps.map((step) => step.label)).toEqual([
      "Event received",
      "Case created",
      "Tasks planned",
      "Equipment checked",
      "Buddy availability checked",
      "Equipment approval required",
    ]);
    expect(steps[0].status).toBe("complete");
    expect(steps[3].status).toBe("attention");
    expect(steps[5].detail).toBe("Draft prepared for approval during initial checks.");
    expect(steps[5].detail).not.toContain("pending approval");
    expect(steps[5].detail).not.toContain("Nothing was sent");
  });

  it("preserves the initial summary through approval, rejection and date changes", () => {
    const initial = executionFixture();
    const approved = executionFixture({ draftStatus: "approved" });
    const rejected = executionFixture({ draftStatus: "rejected" });
    const moved = executionFixture({ startDate: "2026-10-19", equipmentLate: false, includeDraft: false });

    expect(initialExecutionFor(initial, approved, false)).toBe(initial);
    expect(initialExecutionFor(initial, rejected, false)).toBe(initial);
    expect(initialExecutionFor(initial, moved, false)).toBe(initial);
    expect(executionStepsFor(initialExecutionFor(initial, approved, false))[5].detail).toBe("Draft prepared for approval during initial checks.");
  });

  it("replaces the initial summary only on deliberate replay", () => {
    const initial = executionFixture();
    const replay = executionFixture({ startDate: "2026-10-12" });

    expect(initialExecutionFor(null, initial, false)).toBe(initial);
    expect(initialExecutionFor(initial, replay, true)).toBe(replay);
  });
});

describe("buddy simulation target", () => {
  it("keeps the confirmed buddy as the availability simulation target", () => {
    expect(simulationTargetFor(
      { status: "confirmed", candidate_id: "b-06" },
      { candidate_id: "b-01" },
    )).toBe("b-06");
  });
});
