import type { Connector } from "../interface";
import { ok, failed } from "../interface";
import { BUDDIES } from "@/data/buddies";
import { BUDDY_CALENDARS } from "@/data/buddy-calendars";
import { joinerById } from "@/data/joiners";
import { currentJoinerById } from "@/lib/store/joiner-store";
import { assessBuddyAvailability } from "@/lib/policy/buddy-availability";
import { eligibleBuddies } from "@/lib/policy/buddy";

export const buddyDirectory: Connector = {
  name: "buddy_directory",
  description: "Returns only the buddies the policy filter allows for a joiner.",
  simulated: true,
  production_target: "HRIS people query (Humaans people with custom fields for opt-in and active buddies).",
  actions: {
    list_eligible: {
      description: "Eligible buddies, ranked. Empty list is a valid answer and must be escalated, not widened.",
      schema: { joiner_id: "string" },
      run: async ({ joiner_id }) => {
        const j = joinerById(String(joiner_id));
        if (!j) return failed(`No joiner ${joiner_id}`);
        const list = eligibleBuddies(j, BUDDIES).map((b) => ({ id: b.id, full_name: b.full_name, office: b.office, team: b.team, tenure_months: b.tenure_months, active_buddies: b.active_buddies }));
        return ok(`${list.length} eligible buddies for ${j.id}`, list, list.length === 0 ? { next_actions: ["Escalate NO_ELIGIBLE_BUDDY to People"] } : {});
      },
    },
    get_availability: {
      description: "Assess eligible buddy capacity and read-only first-week calendar availability.",
      schema: { joiner_id: "string", start_date: "iso date" },
      run: async ({ joiner_id, start_date }) => {
        const j = currentJoinerById(String(joiner_id)) ?? joinerById(String(joiner_id));
        if (!j) return failed(`No joiner ${joiner_id}`);
        const requestedStart = typeof start_date === "string" ? start_date : j.start_date;
        const result = assessBuddyAvailability(j, BUDDIES, BUDDY_CALENDARS, requestedStart);
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
