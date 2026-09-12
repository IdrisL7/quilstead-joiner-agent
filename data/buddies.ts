import type { BuddyCandidate } from "@/lib/types";

// Twenty-five buddy candidates. Eligibility is decided by code (see lib/policy/buddy.ts):
// opted in, not on leave, tenure of at least six months, fewer than two active buddies,
// same office, or same country and timezone for remote joiners. Munich has nobody
// eligible on purpose (J-005).

export const BUDDIES: BuddyCandidate[] = [
  { id: "b-01", full_name: "Amara Osei", office: "London", country: "UK", timezone: "Europe/London", team: "Platform", tenure_months: 30, active_buddies: 1, on_leave: false, opted_in: true },
  { id: "b-02", full_name: "Rob Fletcher", office: "London", country: "UK", timezone: "Europe/London", team: "Platform", tenure_months: 14, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-03", full_name: "Mei Tanaka", office: "London", country: "UK", timezone: "Europe/London", team: "Integrations", tenure_months: 9, active_buddies: 2, on_leave: false, opted_in: true },
  { id: "b-04", full_name: "Sam Rowe", office: "London", country: "UK", timezone: "Europe/London", team: "Customer Success, EMEA", tenure_months: 22, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-05", full_name: "Zara Malik", office: "London", country: "UK", timezone: "Europe/London", team: "Sales, EMEA", tenure_months: 18, active_buddies: 1, on_leave: true, opted_in: true },
  { id: "b-06", full_name: "Ewan Grant", office: "London", country: "UK", timezone: "Europe/London", team: "Sales, EMEA", tenure_months: 7, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-07", full_name: "Nina Patel", office: "London", country: "UK", timezone: "Europe/London", team: "Finance", tenure_months: 40, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-08", full_name: "Leo Marsh", office: "London", country: "UK", timezone: "Europe/London", team: "Finance", tenure_months: 4, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-09", full_name: "Hana Yusuf", office: "London", country: "UK", timezone: "Europe/London", team: "People", tenure_months: 26, active_buddies: 1, on_leave: false, opted_in: false },

  { id: "b-10", full_name: "Tim Schulz", office: "Berlin", country: "DE", timezone: "Europe/Berlin", team: "Platform", tenure_months: 20, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-11", full_name: "Lea Hoffmann", office: "Berlin", country: "DE", timezone: "Europe/Berlin", team: "Platform", tenure_months: 11, active_buddies: 1, on_leave: false, opted_in: true },
  { id: "b-12", full_name: "Max Richter", office: "Berlin", country: "DE", timezone: "Europe/Berlin", team: "Sales, EMEA", tenure_months: 15, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-13", full_name: "Julia Krause", office: "Berlin", country: "DE", timezone: "Europe/Berlin", team: "Sales, EMEA", tenure_months: 5, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-14", full_name: "Paul Neumann", office: "Berlin", country: "DE", timezone: "Europe/Berlin", team: "People", tenure_months: 3, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-15", full_name: "Anna Lorenz", office: "Munich", country: "DE", timezone: "Europe/Berlin", team: "People", tenure_months: 8, active_buddies: 2, on_leave: false, opted_in: true },
  { id: "b-16", full_name: "Felix Braun", office: "Munich", country: "DE", timezone: "Europe/Berlin", team: "Sales, EMEA", tenure_months: 12, active_buddies: 0, on_leave: true, opted_in: true },

  { id: "b-17", full_name: "Carlos Diaz", office: "Denver", country: "US", timezone: "America/Denver", team: "Sales, North America", tenure_months: 28, active_buddies: 1, on_leave: false, opted_in: true },
  { id: "b-18", full_name: "Emily Stone", office: "Denver", country: "US", timezone: "America/Denver", team: "Sales, North America", tenure_months: 10, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-19", full_name: "Jake Miller", office: "Denver", country: "US", timezone: "America/Denver", team: "Platform", tenure_months: 19, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-20", full_name: "Priyanka Nair", office: "Denver", country: "US", timezone: "America/Denver", team: "Integrations", tenure_months: 16, active_buddies: 1, on_leave: false, opted_in: true },
  { id: "b-21", full_name: "Owen Brooks", office: "Denver", country: "US", timezone: "America/Denver", team: "Finance", tenure_months: 33, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-22", full_name: "Sofia Alvarez", office: "Denver", country: "US", timezone: "America/Denver", team: "Customer Success, North America", tenure_months: 21, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-23", full_name: "Noah Kim", office: "Denver", country: "US", timezone: "America/Denver", team: "Customer Success, North America", tenure_months: 6, active_buddies: 2, on_leave: false, opted_in: true },
  { id: "b-24", full_name: "Isabel Torres", office: "Austin", country: "US", timezone: "America/Chicago", team: "Finance", tenure_months: 25, active_buddies: 0, on_leave: false, opted_in: true },
  { id: "b-25", full_name: "Aaron Cole", office: "Austin", country: "US", timezone: "America/Chicago", team: "Platform", tenure_months: 13, active_buddies: 1, on_leave: false, opted_in: true },
];

export const buddyById = (id: string): BuddyCandidate | undefined => BUDDIES.find((buddy) => buddy.id === id);
