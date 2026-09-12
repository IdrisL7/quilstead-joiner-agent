import type { Connector } from "../interface";
import { ok, failed } from "../interface";
import { BUDDIES } from "@/data/buddies";
import { joinerById } from "@/data/joiners";
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
  },
};
