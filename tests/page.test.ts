import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalEmptyState, simulationTargetFor } from "@/app/page";

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

describe("buddy simulation target", () => {
  it("keeps the confirmed buddy as the availability simulation target", () => {
    expect(simulationTargetFor(
      { status: "confirmed", candidate_id: "b-06" },
      { candidate_id: "b-01" },
    )).toBe("b-06");
  });
});
