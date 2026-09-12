import type { Connector } from "../interface";
import { ok, failed } from "../interface";
import { BUDDIES } from "@/data/buddies";
import { BUDDY_CALENDARS } from "@/data/buddy-calendars";
import { joinerById } from "@/data/joiners";
import { currentJoinerById } from "@/lib/store/joiner-store";
import { assessBuddyAvailability } from "@/lib/policy/buddy-availability";
import { eligibleBuddies } from "@/lib/policy/buddy";
import type { BuddyCalendarSnapshot, BuddyCandidate } from "@/lib/types";

const calendarOverrides = new Map<string, BuddyCalendarSnapshot>();
const capacityReservations = new Map<string, { case_id: string; candidate_id: string }>();

const cloneCalendar = (snapshot: BuddyCalendarSnapshot): BuddyCalendarSnapshot => ({
  ...snapshot,
  working_hours: { ...snapshot.working_hours },
  busy_intervals: snapshot.busy_intervals.map((interval) => ({ ...interval })),
});

export const resetBuddyCalendarState = (): void => {
  calendarOverrides.clear();
};

export const resetBuddyState = (): void => {
  calendarOverrides.clear();
  capacityReservations.clear();
};

function reservationKey(caseId: string, candidateId: string): string {
  return `${caseId}:${candidateId}`;
}

export const reserveBuddyCapacity = (caseId: string, candidateId: string): void => {
  capacityReservations.set(reservationKey(caseId, candidateId), { case_id: caseId, candidate_id: candidateId });
};

export const releaseBuddyCapacity = (caseId: string, candidateId: string): void => {
  capacityReservations.delete(reservationKey(caseId, candidateId));
};

function candidatesWithReservations(caseId?: string): { candidates: BuddyCandidate[]; capacityExemptions: Set<string> } {
  const counts = new Map<string, number>();
  const capacityExemptions = new Set<string>();
  for (const reservation of capacityReservations.values()) {
    counts.set(reservation.candidate_id, (counts.get(reservation.candidate_id) ?? 0) + 1);
    if (reservation.case_id === caseId) capacityExemptions.add(reservation.candidate_id);
  }
  return {
    candidates: BUDDIES.map((candidate) => ({
      ...candidate,
      active_buddies: candidate.active_buddies + (counts.get(candidate.id) ?? 0),
    })),
    capacityExemptions,
  };
}

// A narrow simulation seam for the checkpoint-B availability-change test. It does not
// create calendar events or add scheduling behaviour to the connector.
export const setSimulatedBuddyCalendar = (snapshot: BuddyCalendarSnapshot): void => {
  calendarOverrides.set(snapshot.buddy_id, cloneCalendar(snapshot));
};

function currentCalendars(): BuddyCalendarSnapshot[] {
  return BUDDY_CALENDARS.map((snapshot) => cloneCalendar(calendarOverrides.get(snapshot.buddy_id) ?? snapshot));
}

export const buddyDirectory: Connector = {
  name: "buddy_directory",
  description: "Returns only the buddies the policy filter allows for a joiner.",
  simulated: true,
  production_target: "HRIS people query (Humaans people with custom fields for opt-in and active buddies).",
  actions: {
    list_eligible: {
      description: "Eligible buddies, ranked. Empty list is a valid answer and must be escalated, not widened.",
      schema: { joiner_id: "string", case_id: "string (optional)" },
      run: async ({ joiner_id, case_id }) => {
        const j = joinerById(String(joiner_id));
        if (!j) return failed(`No joiner ${joiner_id}`);
        const { candidates, capacityExemptions } = candidatesWithReservations(typeof case_id === "string" ? case_id : undefined);
        const list = eligibleBuddies(j, candidates, capacityExemptions).map((b) => ({ id: b.id, full_name: b.full_name, office: b.office, team: b.team, tenure_months: b.tenure_months, active_buddies: b.active_buddies }));
        return ok(`${list.length} eligible buddies for ${j.id}`, list, list.length === 0 ? { next_actions: ["Escalate NO_ELIGIBLE_BUDDY to People"] } : {});
      },
    },
    get_availability: {
      description: "Assess eligible buddy capacity and read-only first-week calendar availability.",
      schema: { joiner_id: "string", start_date: "iso date", exclude_buddy_ids: "string[] (optional)", case_id: "string (optional)" },
      run: async ({ joiner_id, start_date, exclude_buddy_ids, case_id }) => {
        const j = currentJoinerById(String(joiner_id)) ?? joinerById(String(joiner_id));
        if (!j) return failed(`No joiner ${joiner_id}`);
        const requestedStart = typeof start_date === "string" ? start_date : j.start_date;
        const excluded = new Set(
          Array.isArray(exclude_buddy_ids)
            ? exclude_buddy_ids.filter((id): id is string => typeof id === "string")
            : [],
        );
        const { candidates, capacityExemptions } = candidatesWithReservations(typeof case_id === "string" ? case_id : undefined);
        const result = assessBuddyAvailability(
          j,
          candidates.filter((buddy) => !excluded.has(buddy.id)),
          currentCalendars(),
          requestedStart,
          capacityExemptions,
        );
        if (result.recommendation) return ok(`Recommended ${result.recommendation.candidate_name} for ${j.id}.`, result);
        return {
          status: "warning" as const,
          summary: result.escalation?.summary ?? `No suitable buddy is available for ${j.id}.`,
          data: result,
          next_actions: result.escalation ? [result.escalation.summary] : ["People must review buddy support by hand."],
        };
      },
    },
  },
};
