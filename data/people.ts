import type { Person } from "@/lib/types";

// Task owners: eight managers, three IT, two People, one Finance approver.
// Slack handles are fictional. `on_leave_until` and `deputy_id` drive the
// MANAGER_UNAVAILABLE edge case.

export const PEOPLE: Person[] = [
  { id: "m-1", full_name: "Rachel Adeyemi", email: "rachel.adeyemi@quilstead.example", function: "manager", office: "London", country: "UK", slack_handle: "@rachel" },
  { id: "m-2", full_name: "Jonas Weber", email: "jonas.weber@quilstead.example", function: "manager", office: "Berlin", country: "DE", slack_handle: "@jonas" },
  { id: "m-3", full_name: "Steve Lang", email: "steve.lang@quilstead.example", function: "manager", office: "Denver", country: "US", slack_handle: "@stevel", on_leave_until: "2026-10-09", deputy_id: "m-8" },
  { id: "m-4", full_name: "Chloe Bennett", email: "chloe.bennett@quilstead.example", function: "manager", office: "London", country: "UK", slack_handle: "@chloe" },
  { id: "m-5", full_name: "Anika Sharma", email: "anika.sharma@quilstead.example", function: "manager", office: "London", country: "UK", slack_handle: "@anika" },
  { id: "m-6", full_name: "David Park", email: "david.park@quilstead.example", function: "manager", office: "Denver", country: "US", slack_handle: "@dpark" },
  { id: "m-7", full_name: "Katrin Vogel", email: "katrin.vogel@quilstead.example", function: "manager", office: "Berlin", country: "DE", slack_handle: "@katrin" },
  { id: "m-8", full_name: "Luis Moreno", email: "luis.moreno@quilstead.example", function: "manager", office: "Denver", country: "US", slack_handle: "@luis" },

  { id: "it-1", full_name: "Nadia Hussain", email: "nadia.hussain@quilstead.example", function: "it", office: "London", country: "UK", slack_handle: "@nadia" },
  { id: "it-2", full_name: "Ben Carter", email: "ben.carter@quilstead.example", function: "it", office: "Denver", country: "US", slack_handle: "@benc" },
  { id: "it-3", full_name: "Kai Weber", email: "kai.weber@quilstead.example", function: "it", office: "Berlin", country: "DE", slack_handle: "@kai" },

  { id: "pp-1", full_name: "Sarah Mitchell", email: "sarah.mitchell@quilstead.example", function: "people", office: "London", country: "UK", slack_handle: "@sarahm" },
  { id: "pp-2", full_name: "Jordan Alvarez", email: "jordan.alvarez@quilstead.example", function: "people", office: "Denver", country: "US", slack_handle: "@jordan" },

  { id: "fin-1", full_name: "Helen Zhao", email: "helen.zhao@quilstead.example", function: "finance", office: "London", country: "UK", slack_handle: "@helenz" },
];

export const personById = (id: string): Person | undefined => PEOPLE.find((p) => p.id === id);

// Which owner handles a function for a given country. Deterministic routing table.
export const OWNER_BY_FUNCTION_AND_COUNTRY: Record<"it" | "people" | "finance", Record<"UK" | "US" | "DE", string>> = {
  it: { UK: "it-1", US: "it-2", DE: "it-3" },
  people: { UK: "pp-1", US: "pp-2", DE: "pp-1" },
  finance: { UK: "fin-1", US: "fin-1", DE: "fin-1" },
};

// SLA in hours per task type, from the moment the task is created.
export const SLA_HOURS: Record<string, number> = {
  hris_profile: 24,
  right_to_work: 24,
  i9_section_1: 24,
  i9_section_2: 24,
  tax_forms: 72,
  works_council_notice: 24,
  social_insurance_registration: 72,
  access_request: 48,
  equipment_order: 120,
  esign_pack: 72,
  slack_invite: 24,
  buddy_allocation: 72,
  manager_day_one_plan: 72,
  welcome_message: 24,
};
