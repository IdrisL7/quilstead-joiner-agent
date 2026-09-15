import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EVENTS } from "@/data/events";
import { DEMO_TRIGGER_PREVIEW } from "@/data/demo-trigger";
import { JOINERS } from "@/data/joiners";
import { workFocusFor, ApprovalEmptyState, AskAthenaPanel, backgroundCaseFor, backgroundRefreshBlocked, buddyCandidatesFor, candidateRequestTagFor, committedJoinerSelection, DemoRequestError, draftEditBlocksCaseMutation, equipmentApprovalRecovery, executionStepsFor, initialExecutionFor, managerEditRebase, currentMonitorAlerts, monitorAlertKey, monitorNotificationNavigationBlocked, monitorNotificationText, monitorStatusLabel, postDemo, simulationTargetFor, startDateRequestFor, WorkflowTriggerCard } from "@/app/page";
import { OnboardingScenario } from "@/app/components/onboarding-scenarios";
import { BackgroundUpdateNotice, equipmentMessageHistoryText } from "@/app/page";
import type { OnboardingView } from "@/lib/onboarding-view";

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

const scenarioView = {
  profile: { name: "Aisha Okafor", preferred_name: "Aisha", title: "Customer Success Manager", team: "Customer Success", office: "London", work_mode: "hybrid", start_date: "2026-10-12", manager_name: "Chloe Bennett", setup: [] },
  access: [],
  manager: { name: "Chloe Bennett", tasks: [], escalations: [], coordination: null },
  tasks: [],
  first_day: { start_date: "2026-10-12", office: "London", work_mode: "hybrid", manager_name: "Chloe Bennett", people_contact: "Sarah Mitchell", arrival_time: null, office_address: null, items_to_bring: null, outline: null, confirmed_plan_id: null },
} as OnboardingView;

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
    expect(html).toContain("16 Oct 2026");
    expect(html).toContain("9 Oct 2026");
    expect(html).not.toContain("No message needed");
  });

  it("only renders no message needed after the current facts clear the risk", () => {
    const html = render({ screen_state: "no_action", equipment_late: false });

    expect(html).toContain("No message needed");
    expect(html).not.toContain("Draft unavailable");
  });
});

describe("approval recovery response", () => {
  it("retains structured 409 state so the page can replace a stale approval screen", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(JSON.stringify({
      error: "This equipment draft is stale because the supplier information changed.",
      recovery: "equipment_reassessment",
      run_id: "DEMO-RUN-RECOVERY",
      case: { id: "CASE-J-004" },
      screen_state: "draft_unavailable",
      draft: null,
      draft_unavailable: { message: "Run the equipment reassessment again." },
    }), { status: 409, headers: { "Content-Type": "application/json" } });
    try {
      await postDemo({ decision: "approve" });
      throw new Error("Expected the stale approval to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DemoRequestError);
      expect(equipmentApprovalRecovery(error, "CASE-J-004")).toMatchObject({
        run_id: "DEMO-RUN-RECOVERY",
        screen_state: "draft_unavailable",
        draft: null,
      });
      expect(equipmentApprovalRecovery(error, "CASE-J-001")).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("does not adopt arbitrary conflict payloads as equipment recovery state", () => {
    const payload = {
      error: "Another conflict",
      run_id: "DEMO-RUN-OTHER",
      case: { id: "CASE-J-004" },
      screen_state: "draft_unavailable",
      draft: null,
      draft_unavailable: { message: "Retry." },
    } as never;
    expect(equipmentApprovalRecovery(new DemoRequestError("Another conflict", 409, payload), "CASE-J-004")).toBeNull();
  });
});

describe("joiner selector commit", () => {
  it("keeps the loaded case selected until a requested switch succeeds", () => {
    expect(committedJoinerSelection("J-004")).toBe("J-004");
    expect(committedJoinerSelection("J-004", "J-001")).toBe("J-001");
  });
});

describe("safe monitoring presentation", () => {
  it("shows a retained-update warning only while an unsaved editor is open", () => {
    const renderNotice = (hasUpdate: boolean, editingEquipment: boolean, editingManager: boolean) => renderToStaticMarkup(createElement(BackgroundUpdateNotice, { hasUpdate, editingEquipment, editingManager }));
    expect(renderNotice(true, false, false)).toBe("");
    expect(renderNotice(false, true, false)).toBe("");
    expect(renderNotice(true, true, false)).toContain("Your unsaved wording is preserved");
    expect(renderNotice(true, false, true)).toContain("Your unsaved wording is preserved");
  });

  it("distinguishes unavailable equipment drafts from cleared risk in the detail panel", () => {
    const run = executionFixture({ includeDraft: false });
    expect(equipmentMessageHistoryText({ ...run, screen_state: "draft_unavailable" })).toContain("Equipment risk remains");
    expect(equipmentMessageHistoryText({ ...run, screen_state: "no_action" })).not.toContain("No equipment message is needed");
    expect(equipmentMessageHistoryText({ ...run, screen_state: "no_action", facts: { ...run.facts, equipment_late: false } })).toBe("No equipment message is needed.");
    const approved = executionFixture({ draftStatus: "approved" });
    expect(equipmentMessageHistoryText({ ...approved, screen_state: "resolved" })).toBe(approved.draft?.body);
  });

  it("adopts only the selected case and blocks replacement during either draft edit", () => {
    const aisha = { case: { id: "CASE-J-004" }, joiner: { id: "J-004" } };
    const priya = { case: { id: "CASE-J-001" }, joiner: { id: "J-001" } };
    expect(backgroundCaseFor([aisha, priya] as never, "CASE-J-004", "J-004")).toBe(aisha);
    expect(backgroundCaseFor([priya] as never, "CASE-J-004", "J-004")).toBeNull();
    expect(backgroundCaseFor([aisha] as never, "CASE-J-004", "J-001")).toBeNull();
    expect(backgroundRefreshBlocked(true, false, false)).toBe(true);
    expect(backgroundRefreshBlocked(false, true, false)).toBe(true);
    expect(backgroundRefreshBlocked(false, false, true)).toBe(true);
    expect(backgroundRefreshBlocked(false, false, false)).toBe(false);
  });

  it("keeps monitoring navigation locked while either exact draft is being edited", () => {
    expect(monitorNotificationNavigationBlocked(false, false, true)).toBe(true);
    expect(monitorNotificationNavigationBlocked(false, true, false)).toBe(true);
    expect(monitorNotificationNavigationBlocked(true, false, false)).toBe(true);
    expect(monitorNotificationNavigationBlocked(false, false, false)).toBe(false);
  });

  it("rebases a manager edit only when case, request and exact draft identities are unchanged", () => {
    const current = {
      run_id: "RUN-1",
      case: { id: "CASE-J-004" },
      joiner: { id: "J-004" },
      manager_coordination: {
        request: { id: "MANAGER-1", status: "pending_approval" },
        draft: { id: "DRAFT-1", status: "pending" },
      },
    };
    const refreshed = structuredClone(current);
    refreshed.run_id = "RUN-2";
    expect(managerEditRebase(current as never, refreshed as never)).toBe(refreshed);

    const changedDraft = structuredClone(refreshed);
    changedDraft.manager_coordination.draft.id = "DRAFT-2";
    expect(managerEditRebase(current as never, changedDraft as never)).toBeNull();

    const otherCase = structuredClone(refreshed);
    otherCase.case.id = "CASE-J-001";
    expect(managerEditRebase(current as never, otherCase as never)).toBeNull();
  });

  it("uses calm monitor labels and case-derived notification facts", () => {
    expect(monitorStatusLabel("watching")).toBe("Watching equipment updates");
    expect(monitorStatusLabel("checking")).toBe("Checking a change");
    expect(monitorStatusLabel("needs_attention")).toBe("Needs attention");
    expect(monitorStatusLabel("paused")).toBe("Paused");
    const monitoredCase = {
      joiner: { full_name: "Priya Raman" },
      facts: { equipment_eta: "2026-10-09", start_date: "2026-10-05" },
    };
    const text = monitorNotificationText({
      outcome: "proposal_prepared",
      equipment_eta: "2026-10-09",
      start_date: "2026-10-05",
    } as never, monitoredCase as never);
    expect(text).toContain("Priya Raman's laptop");
    expect(text).toContain("9 Oct 2026");
    expect(text).toContain("5 Oct 2026");
    expect(text).toContain("loaner or earlier delivery");

    const historicalText = monitorNotificationText({
      outcome: "proposal_prepared",
      equipment_eta: "2026-10-09",
      start_date: "2026-10-05",
    } as never, {
      joiner: { full_name: "Priya Raman" },
      facts: { equipment_eta: "2026-10-02", start_date: "2026-10-05" },
    } as never);
    expect(historicalText).toContain("9 Oct 2026");
    expect(historicalText).not.toContain("2 Oct 2026");
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

  it("presents the chat-first entry scope and the three discovery asks", () => {
    const html = renderToStaticMarkup(createElement(AskAthenaPanel, {
      history: [],
      question: "",
      entry: true,
      busy: false,
      onQuestionChange: () => undefined,
      onAsk: () => undefined,
      onNavigate: () => undefined,
    }));

    expect(html).toContain("Let’s get Aisha ready for day one");
    expect(html).toContain("Fictional demo");
    expect(html).toContain("This demo follows Aisha Okafor’s onboarding at Quilstead.");
    expect(html).toContain("Check Aisha’s onboarding readiness.");
    expect(html).toContain("Find an available buddy for Aisha.");
    expect(html).toContain("What changes if Aisha starts on 19 October?");
    expect(html).not.toContain("What&#x27;s left before day one?");
  });

  it("shows a live processing state while the entry question opens the case", () => {
    const html = renderToStaticMarkup(createElement(AskAthenaPanel, {
      history: [],
      question: "Check Aisha’s onboarding readiness.",
      entry: true,
      busy: true,
      onQuestionChange: () => undefined,
      onAsk: () => undefined,
      onNavigate: () => undefined,
    }));

    expect(html).toContain("Opening Aisha’s case and checking current evidence...");
    expect(html).toContain('role="status"');
    expect(html).toContain("disabled");
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

describe("chat start-date interpretation", () => {
  it("asks for confirmation without changing the case date", () => {
    expect(startDateRequestFor("Please change Aisha's start date to 19 October", "2026-10-12")).toEqual({
      kind: "confirm",
      date: "2026-10-19",
      label: "19 Oct 2026",
    });
    expect(startDateRequestFor("What changes if Aisha starts on 19 October?", "2026-10-12")).toBeNull();
  });

  it("ignores negations, questions and non-date requests that mention the start", () => {
    for (const question of [
      "don't move the start date to 19 October",
      "did the start date change to 19 October?",
      "why did the start move to 19 October",
      "set a reminder for the first day on 19 October",
      "make sure the laptop arrives before the start date",
    ]) expect(startDateRequestFor(question, "2026-10-12"), question).toBeNull();
  });

  it("reads ordinals and asks again for a weekend", () => {
    expect(startDateRequestFor("Move start to 19th October", "2026-10-12")).toMatchObject({ kind: "confirm", date: "2026-10-19" });
    expect(startDateRequestFor("shift start to 3rd of November", "2026-10-12")).toMatchObject({ kind: "confirm", date: "2026-11-03" });
    const weekend = startDateRequestFor("move the start date to Sunday 18 October", "2026-10-12");
    expect(weekend?.kind).toBe("clarify");
    expect(weekend?.message).toContain("Sunday");
  });

  it("asks for clarification when an action has no interpretable date", () => {
    const interpretation = startDateRequestFor("Change Aisha's start date", "2026-10-12");
    expect(interpretation?.kind).toBe("clarify");
    expect(interpretation?.message).toContain("Which start date should I use?");
  });

  it("renders one clarification for a vague start-date action", () => {
    const html = renderToStaticMarkup(createElement(AskAthenaPanel, {
      history: [{
        id: "ask-clarify",
        question: "Change Aisha's start date",
        answer: {
          answer: "I can only answer from this case. Could you clarify which current fact you need?",
          links: [],
          card: null,
          facts: ["Start date: 2026-10-12"],
          provider: "mock",
          model: "deterministic-ask-model",
          cost_usd: 0,
        },
        snapshot: {} as never,
      }],
      question: "",
      busy: false,
      currentRun: null,
      dateChangeRequest: {
        kind: "clarify",
        history_id: "ask-clarify",
        message: "Which start date should I use? Include a date such as 19 October 2026. No change has been made.",
      },
      onQuestionChange: () => undefined,
      onAsk: () => undefined,
      onNavigate: () => undefined,
      onConfirmDateChange: () => undefined,
      onDismissDateChange: () => undefined,
    }));

    expect(html).not.toContain("I can only answer from this case");
    expect(html).toContain("Which start date should I use?");
  });
});

describe("buddy candidate comparison", () => {
  it("labels the confirmed candidate and exposes a selectable available alternative", () => {
    const candidates = [
      { candidate: { id: "b-04" }, eligibility: { eligible: true }, availability: { status: "unknown" as const } },
      { candidate: { id: "b-07" }, eligibility: { eligible: true }, availability: { status: "error" as const } },
      { candidate: { id: "b-02" }, eligibility: { eligible: true }, availability: { status: "busy" as const } },
      { candidate: { id: "b-06" }, eligibility: { eligible: true }, availability: { status: "available" as const } },
      { candidate: { id: "b-01" }, eligibility: { eligible: true }, availability: { status: "available" as const } },
    ];
    const view = buddyCandidatesFor(candidates, { status: "confirmed", candidate_id: "b-06" }, { candidate_id: "b-06" });

    expect(view.candidates.map((assessment) => assessment.candidate.id)).toEqual(["b-04", "b-07", "b-06", "b-01"]);
    expect(view.alternativeCandidateId).toBe("b-01");
    expect(candidateRequestTagFor({ status: "confirmed", candidate_id: "b-06" }, "b-06")).toEqual({ label: "Confirmed", tone: "positive" });
    expect(candidateRequestTagFor({ status: "confirmed", candidate_id: "b-06" }, "b-01")).toBeNull();
  });
});


describe("question-focused workstreams", () => {
  it("blocks case mutations during either equipment or manager draft editing", () => {
    expect(draftEditBlocksCaseMutation(true, false)).toBe(true);
    expect(draftEditBlocksCaseMutation(false, true)).toBe(true);
    expect(draftEditBlocksCaseMutation(false, false)).toBe(false);
  });
  it("shows every workstream for readiness and keeps narrow questions focused", () => {
    expect(workFocusFor("Check Aisha’s onboarding readiness.", "timeline")).toBe("all");
    expect(workFocusFor("What's left before day one?", "timeline")).toBe("all");
    expect(workFocusFor("Find an available buddy for Aisha.", "buddy")).toBe("buddy");
    expect(workFocusFor("Is the laptop sorted?", "equipment")).toBe("equipment");
    expect(workFocusFor("Any compliance risk?", "timeline")).toBe("compliance");
  });
  it("keeps hypothetical and explicit date questions separate from approval cards", () => {
    expect(workFocusFor("What changes if Aisha starts on 19 October?", "timeline")).toBe("dates");
    expect(workFocusFor("Change Aisha start date to 19 October", "timeline")).toBe("dates");
    expect(workFocusFor("What if the laptop delivery slips?", "equipment")).toBe("equipment");
    expect(workFocusFor("Who owns access requests?", "timeline")).toBe("answer");
    expect(workFocusFor("What is the coffee policy?")).toBe("answer");
  });
});

describe("manager coordination recovery UI", () => {
  const baseProps = {
    kind: "manager" as const,
    view: scenarioView,
    compact: false,
    onOpen: () => undefined,
    onAsk: () => undefined,
  };

  it("keeps Save and Cancel available while other case mutations are blocked", () => {
    const html = renderToStaticMarkup(createElement(OnboardingScenario, {
      ...baseProps,
      disabled: true,
      managerEditDisabled: false,
      editingManager: true,
      managerEditSubject: "First-day details",
      managerEditBody: "Unsaved wording",
      managerCoordination: {
        request: { id: "MANAGER-1", manager_name: "Chloe Bennett", status: "pending_approval" },
        draft: { id: "DRAFT-1", recipient: "Chloe Bennett", subject: "First-day details", body: "Original wording", status: "pending" },
      },
    }));
    expect(html).toContain("Save new version");
    expect(html).toContain("Cancel");
    expect(html).not.toMatch(/disabled[^>]*>Save new version/);
    expect(html).not.toMatch(/disabled[^>]*>Cancel/);
  });

  it("shows a retry for the same approved draft after delivery fails", () => {
    const html = renderToStaticMarkup(createElement(OnboardingScenario, {
      ...baseProps,
      disabled: false,
      managerCoordination: {
        request: { id: "MANAGER-1", manager_name: "Chloe Bennett", status: "send_failed", send_error: "Temporary Slack failure" },
        draft: { id: "DRAFT-1", recipient: "Chloe Bennett", subject: "First-day details", body: "Approved wording", status: "approved" },
      },
    }));
    expect(html).toContain("Approved request was not delivered");
    expect(html).toContain("Your exact approval is preserved");
    expect(html).toContain("Retry approved request");
  });
});


describe("monitor alert lifecycle", () => {
  const notification = { id: "N1", case_id: "CASE-J-001", joiner_id: "J-001", at: "2026-09-15T10:00:00Z", source_revision: 2, equipment_eta: "2026-10-09", start_date: "2026-10-05", outcome: "proposal_prepared" as const, draft_id: "D1" };
  const current = { case: { id: "CASE-J-001" }, joiner: { id: "J-001" }, facts: { equipment_eta: "2026-10-09", start_date: "2026-10-05", equipment_late: true }, draft: { id: "D1", status: "pending" } };

  it("hides reviewed alerts without hiding a genuinely new alert", () => {
    expect(currentMonitorAlerts([notification], [current] as never, [])).toHaveLength(1);
    const reviewed = [monitorAlertKey(notification)];
    expect(currentMonitorAlerts([notification], [current] as never, reviewed)).toEqual([]);
    const fresh = { ...notification, at: "2026-09-15T11:00:00Z", draft_id: "D2" };
    const changed = { ...current, draft: { id: "D2", status: "pending" } };
    expect(currentMonitorAlerts([fresh], [changed] as never, reviewed)).toHaveLength(1);
  });

  it("shows only the latest case update and does not resurrect older alerts when dismissed", () => {
    const cleared = { ...notification, id: "N2", source_revision: 3, equipment_eta: "2026-10-02", outcome: "risk_cleared" as const, draft_id: null };
    const onTime = { ...current, facts: { ...current.facts, equipment_eta: "2026-10-02", equipment_late: false }, draft: null };
    expect(currentMonitorAlerts([notification, cleared], [onTime] as never, []).map(x => x.notification.id)).toEqual(["N2"]);
    expect(currentMonitorAlerts([notification, cleared], [onTime] as never, [monitorAlertKey(cleared)])).toEqual([]);
  });

  it("removes obsolete proposals and rejects mismatched case evidence", () => {
    for (const changed of [
      { ...current, draft: { id: "D1", status: "approved" } },
      { ...current, draft: { id: "D2", status: "pending" } },
      { ...current, joiner: { id: "J-004" } },
      { ...current, facts: { ...current.facts, start_date: "2026-10-19" } },
    ]) expect(currentMonitorAlerts([notification], [changed] as never, [])).toEqual([]);
  });
});
