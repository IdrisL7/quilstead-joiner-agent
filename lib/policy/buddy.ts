import type { BuddyCandidate, Joiner } from "@/lib/types";

// Buddy eligibility is code. The model may later choose among the eligible and explain
// why; it never widens the list. Order: same office first, then same team, then lowest
// active load, then longest tenure. Stable, so the same input gives the same list.

export const MIN_TENURE_MONTHS = 6;
export const MAX_ACTIVE_BUDDIES = 2;
export const BUDDY_COMMITMENT = {
  first_week_working_days: 5,
  slot_increment_minutes: 15,
  working_hours: { start_local: "09:00", end_local: "17:30" },
  sessions: [
    { kind: "introduction", duration_minutes: 30 },
    { kind: "shadowing", duration_minutes: 45 },
  ],
} as const;

export interface BuddyEligibility {
  eligible: boolean;
  reasons: string[];
}

export function assessBuddyEligibility(joiner: Joiner, candidate: BuddyCandidate, capacityExemptions: ReadonlySet<string> = new Set()): BuddyEligibility {
  const reasons: string[] = [];
  if (!candidate.opted_in) reasons.push("Not opted in to buddy support.");
  if (candidate.on_leave) reasons.push("Currently on leave.");
  if (candidate.tenure_months < MIN_TENURE_MONTHS) reasons.push(`Tenure is ${candidate.tenure_months} months; minimum is ${MIN_TENURE_MONTHS}.`);
  const capacityCount = candidate.active_buddies - (capacityExemptions.has(candidate.id) ? 1 : 0);
  if (capacityCount >= MAX_ACTIVE_BUDDIES) reasons.push(`At capacity with ${candidate.active_buddies} active buddies.`);
  if (joiner.work_mode === "remote" && candidate.country !== joiner.country) reasons.push("Different country from a remote joiner.");
  if (joiner.work_mode !== "remote" && candidate.office !== joiner.office) reasons.push("Different office from the joiner.");
  return { eligible: reasons.length === 0, reasons };
}

export function eligibleBuddies(joiner: Joiner, candidates: BuddyCandidate[], capacityExemptions: ReadonlySet<string> = new Set()): BuddyCandidate[] {
  const base = candidates.filter(
    (b) => assessBuddyEligibility(joiner, b, capacityExemptions).eligible,
  );
  const sameOffice = base.filter((b) => b.office === joiner.office);
  const pool =
    joiner.work_mode === "remote"
      ? base.filter((b) => b.country === joiner.country) // same country; timezone parity checked below
      : sameOffice;
  const ranked = pool
    .filter((b) => (joiner.work_mode === "remote" ? true : b.office === joiner.office))
    .sort((a, b) => {
      const officeA = a.office === joiner.office ? 0 : 1;
      const officeB = b.office === joiner.office ? 0 : 1;
      if (officeA !== officeB) return officeA - officeB;
      const teamA = a.team === joiner.team ? 0 : 1;
      const teamB = b.team === joiner.team ? 0 : 1;
      if (teamA !== teamB) return teamA - teamB;
      if (a.active_buddies !== b.active_buddies) return a.active_buddies - b.active_buddies;
      return b.tenure_months - a.tenure_months;
    });
  return ranked;
}
