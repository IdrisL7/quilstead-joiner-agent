import { describe, expect, it } from "vitest";
import { BUDDIES } from "@/data/buddies";
import { BUDDY_CALENDARS } from "@/data/buddy-calendars";
import { joinerById } from "@/data/joiners";
import { findAction } from "@/lib/connectors/registry";
import { authorize } from "@/lib/permissions";
import { assessBuddyAvailability, firstWorkingWeek, proposedBuddySlots } from "@/lib/policy/buddy-availability";

const aisha = joinerById("J-004")!;

describe("buddy capacity and simulated availability", () => {
  it("does not recommend a candidate at capacity or one without the required slots", () => {
    const result = assessBuddyAvailability(aisha, BUDDIES, BUDDY_CALENDARS);
    const atCapacity = result.candidates.find((assessment) => assessment.candidate.id === "b-03")!;
    const fullyBooked = result.candidates.find((assessment) => assessment.candidate.id === "b-02")!;

    expect(atCapacity.eligibility.eligible).toBe(false);
    expect(atCapacity.eligibility.reasons).toContain("At capacity with 2 active buddies.");
    expect(atCapacity.availability.status).toBe("unavailable");
    expect(fullyBooked.eligibility.eligible).toBe(true);
    expect(fullyBooked.availability.status).toBe("busy");
    expect(result.recommendation?.candidate_id).toBe("b-06");
  });

  it("calculates two non-overlapping slots inside the first working week", () => {
    const candidate = BUDDIES.find((buddy) => buddy.id === "b-01")!;
    const snapshot = BUDDY_CALENDARS.find((calendar) => calendar.buddy_id === candidate.id)!;
    const slots = proposedBuddySlots(candidate, snapshot, aisha.start_date);

    expect(firstWorkingWeek(aisha.start_date)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
    ]);
    expect(slots).toHaveLength(2);
    expect(slots.map((slot) => slot.duration_minutes)).toEqual([30, 45]);
    expect(slots[0].timezone).toBe("Europe/London");
    expect(Date.parse(slots[0].end_at)).toBeLessThanOrEqual(Date.parse(slots[1].start_at));
  });

  it("keeps unknown calendar data distinct from a busy calendar", () => {
    const result = assessBuddyAvailability(aisha, BUDDIES, BUDDY_CALENDARS);
    const unknown = result.candidates.find((assessment) => assessment.candidate.id === "b-04")!;
    const busy = result.candidates.find((assessment) => assessment.candidate.id === "b-02")!;

    expect(unknown.availability.status).toBe("unknown");
    expect(unknown.availability.reason).toContain("unknown");
    expect(unknown.availability.slots).toHaveLength(0);
    expect(busy.availability.status).toBe("busy");
  });

  it("returns a named People escalation when eligible candidates have no suitable slots", () => {
    const candidates = BUDDIES.filter((buddy) => buddy.id === "b-01" || buddy.id === "b-02");
    const fullyBooked = BUDDY_CALENDARS.find((calendar) => calendar.buddy_id === "b-02")!;
    const snapshots = [
      { ...fullyBooked, buddy_id: "b-01" },
      fullyBooked,
    ];
    const result = assessBuddyAvailability(aisha, candidates, snapshots);

    expect(result.recommendation).toBeNull();
    expect(result.escalation).toMatchObject({
      code: "NO_AVAILABLE_BUDDY",
      to_function: "people",
      to_person_id: "pp-1",
      to_person_name: "Sarah Mitchell",
    });
  });

  it("returns the existing named People escalation when policy finds nobody eligible", () => {
    const sofia = joinerById("J-005")!;
    const candidates = BUDDIES.filter((buddy) => buddy.id === "b-15" || buddy.id === "b-16");
    const result = assessBuddyAvailability(sofia, candidates, BUDDY_CALENDARS);

    expect(result.recommendation).toBeNull();
    expect(result.escalation).toMatchObject({
      code: "NO_ELIGIBLE_BUDDY",
      to_function: "people",
      to_person_id: "pp-1",
      to_person_name: "Sarah Mitchell",
    });
  });

  it("registers read-only availability behind the automatic permission", async () => {
    expect(authorize("buddy_directory.get_availability").mode).toBe("automatic");
    const action = findAction("buddy_directory.get_availability");
    expect(action).toBeDefined();

    const result = await action!.action.run({ joiner_id: aisha.id, start_date: aisha.start_date });
    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({ recommendation: { candidate_id: "b-06" } });
  });
});
