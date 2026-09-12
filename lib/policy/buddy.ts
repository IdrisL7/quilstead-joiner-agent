import type { BuddyCandidate, Joiner } from "@/lib/types";

// Buddy eligibility is code. The model may later choose among the eligible and explain
// why; it never widens the list. Order: same office first, then same team, then lowest
// active load, then longest tenure. Stable, so the same input gives the same list.

export const MIN_TENURE_MONTHS = 6;
export const MAX_ACTIVE_BUDDIES = 2;

export function eligibleBuddies(joiner: Joiner, candidates: BuddyCandidate[]): BuddyCandidate[] {
  const base = candidates.filter(
    (b) => b.opted_in && !b.on_leave && b.tenure_months >= MIN_TENURE_MONTHS && b.active_buddies < MAX_ACTIVE_BUDDIES,
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
