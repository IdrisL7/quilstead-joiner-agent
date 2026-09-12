import { OWNER_BY_FUNCTION_AND_COUNTRY, personById } from "@/data/people";
import { addWorkingDays, isWeekend, toDate, toIsoDate } from "@/lib/policy/dates";
import { BUDDY_COMMITMENT, assessBuddyEligibility, eligibleBuddies, type BuddyEligibility } from "@/lib/policy/buddy";
import type {
  BuddyAvailabilityStatus,
  BuddyBusyInterval,
  BuddyCalendarSnapshot,
  BuddyCandidate,
  BuddySlot,
  EscalationCode,
  Joiner,
} from "@/lib/types";

interface CandidateSummary {
  id: string;
  full_name: string;
  office: string;
  timezone: string;
  team: string;
  tenure_months: number;
  active_buddies: number;
}

export interface BuddyAvailability {
  status: BuddyAvailabilityStatus;
  reason: string;
  snapshot_at?: string;
  timezone?: string;
  slots: BuddySlot[];
}

export interface BuddyCandidateAssessment {
  candidate: CandidateSummary;
  eligibility: BuddyEligibility;
  availability: BuddyAvailability;
}

export interface BuddyRecommendation {
  candidate_id: string;
  candidate_name: string;
  reason: string;
  slots: BuddySlot[];
}

export interface BuddyAvailabilityEscalation {
  code: Extract<EscalationCode, "NO_ELIGIBLE_BUDDY" | "NO_AVAILABLE_BUDDY">;
  to_function: "people";
  to_person_id: string;
  to_person_name: string;
  summary: string;
  evidence: string[];
}

export interface BuddyAvailabilityResult {
  joiner_id: string;
  start_date: string;
  commitment: typeof BUDDY_COMMITMENT;
  candidates: BuddyCandidateAssessment[];
  recommendation: BuddyRecommendation | null;
  escalation: BuddyAvailabilityEscalation | null;
}

function minutesFromLocalTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid local time: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid local time: ${value}`);
  return hours * 60 + minutes;
}

function localTimeAt(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function localTimestamp(date: string, time: string, utcOffsetMinutes: number): string {
  const local = toDate(date);
  const minutes = minutesFromLocalTime(time);
  local.setUTCHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  local.setUTCMinutes(local.getUTCMinutes() - utcOffsetMinutes);
  return local.toISOString();
}

export function firstWorkingWeek(startDate: string): string[] {
  let first = toDate(startDate);
  while (isWeekend(first)) first = toDate(addWorkingDays(toIsoDate(first), 1));
  return Array.from({ length: BUDDY_COMMITMENT.first_week_working_days }, (_, index) => addWorkingDays(toIsoDate(first), index));
}

export function calendarCoversFirstWorkingWeek(snapshot: BuddyCalendarSnapshot, startDate: string): boolean {
  return firstWorkingWeek(startDate).every((date) => date >= snapshot.coverage_start_date && date <= snapshot.coverage_end_date);
}

function coverageReason(snapshot: BuddyCalendarSnapshot, startDate: string): string {
  const dates = firstWorkingWeek(startDate);
  return `Calendar coverage ${snapshot.coverage_start_date} to ${snapshot.coverage_end_date} does not include the full requested first working week ${dates[0]} to ${dates[dates.length - 1]}.`;
}

function overlaps(startAt: string, endAt: string, interval: BuddyBusyInterval): boolean {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  const busyStart = Date.parse(interval.start_at);
  const busyEnd = Date.parse(interval.end_at);
  if (![start, end, busyStart, busyEnd].every(Number.isFinite)) throw new Error("Buddy calendar contains an invalid interval");
  return start < busyEnd && end > busyStart;
}

function candidateSummary(candidate: BuddyCandidate): CandidateSummary {
  return {
    id: candidate.id,
    full_name: candidate.full_name,
    office: candidate.office,
    timezone: candidate.timezone,
    team: candidate.team,
    tenure_months: candidate.tenure_months,
    active_buddies: candidate.active_buddies,
  };
}

function freeSlot(
  candidate: BuddyCandidate,
  snapshot: BuddyCalendarSnapshot,
  dates: string[],
  kind: BuddySlot["kind"],
  durationMinutes: number,
  selected: BuddySlot[],
): BuddySlot | undefined {
  const workdayStart = minutesFromLocalTime(snapshot.working_hours.start_local);
  const workdayEnd = minutesFromLocalTime(snapshot.working_hours.end_local);
  for (const date of dates) {
    for (let startMinutes = workdayStart; startMinutes + durationMinutes <= workdayEnd; startMinutes += BUDDY_COMMITMENT.slot_increment_minutes) {
      const startAt = localTimestamp(date, localTimeAt(startMinutes), snapshot.utc_offset_minutes);
      const endAt = localTimestamp(date, localTimeAt(startMinutes + durationMinutes), snapshot.utc_offset_minutes);
      const conflictsWithBusy = snapshot.busy_intervals.some((interval) => overlaps(startAt, endAt, interval));
      const conflictsWithSelected = selected.some((slot) => Date.parse(startAt) < Date.parse(slot.end_at) && Date.parse(endAt) > Date.parse(slot.start_at));
      if (conflictsWithBusy || conflictsWithSelected) continue;
      return {
        id: `${candidate.id}-${kind}-${date}-${localTimeAt(startMinutes).replace(":", "")}`,
        kind,
        start_at: startAt,
        end_at: endAt,
        timezone: snapshot.timezone,
        duration_minutes: durationMinutes,
      };
    }
  }
  return undefined;
}

export function proposedBuddySlots(
  candidate: BuddyCandidate,
  snapshot: BuddyCalendarSnapshot,
  startDate: string,
): BuddySlot[] {
  if (!calendarCoversFirstWorkingWeek(snapshot, startDate)) return [];
  const dates = firstWorkingWeek(startDate);
  const slots: BuddySlot[] = [];
  for (const session of BUDDY_COMMITMENT.sessions) {
    const slot = freeSlot(candidate, snapshot, dates, session.kind, session.duration_minutes, slots);
    if (!slot) return slots;
    slots.push(slot);
  }
  return slots;
}

function unavailableAvailability(eligibility: BuddyEligibility): BuddyAvailability {
  return {
    status: "unavailable",
    reason: eligibility.reasons.join(" "),
    slots: [],
  };
}

function assessAvailability(
  candidate: BuddyCandidate,
  eligibility: BuddyEligibility,
  snapshot: BuddyCalendarSnapshot | undefined,
  startDate: string,
): BuddyAvailability {
  if (!eligibility.eligible) return unavailableAvailability(eligibility);
  if (!snapshot) {
    return {
      status: "unknown",
      reason: "Calendar availability is unknown; People must verify the candidate before proposing times.",
      slots: [],
    };
  }
  if (snapshot.read_status === "unknown") {
    return {
      status: "unknown",
      reason: "Calendar availability is unknown; People must verify the candidate before proposing times.",
      snapshot_at: snapshot.captured_at,
      timezone: snapshot.timezone,
      slots: [],
    };
  }
  if (snapshot.read_status === "error") {
    return {
      status: "error",
      reason: "Calendar availability could not be read; People must verify the candidate before proposing times.",
      snapshot_at: snapshot.captured_at,
      timezone: snapshot.timezone,
      slots: [],
    };
  }
  if (!calendarCoversFirstWorkingWeek(snapshot, startDate)) {
    return {
      status: "unknown",
      reason: coverageReason(snapshot, startDate),
      snapshot_at: snapshot.captured_at,
      timezone: snapshot.timezone,
      slots: [],
    };
  }
  const slots = proposedBuddySlots(candidate, snapshot, startDate);
  if (slots.length !== BUDDY_COMMITMENT.sessions.length) {
    return {
      status: "busy",
      reason: "No two non-overlapping first-week slots meet the demo commitment.",
      snapshot_at: snapshot.captured_at,
      timezone: snapshot.timezone,
      slots,
    };
  }
  return {
    status: "available",
    reason: "Two non-overlapping first-week slots meet the demo commitment.",
    snapshot_at: snapshot.captured_at,
    timezone: snapshot.timezone,
    slots,
  };
}

function escalationFor(joiner: Joiner, candidates: BuddyCandidateAssessment[], eligibleCount: number): BuddyAvailabilityEscalation {
  const toPersonId = OWNER_BY_FUNCTION_AND_COUNTRY.people[joiner.country];
  const toPersonName = personById(toPersonId)?.full_name ?? toPersonId;
  if (eligibleCount === 0) {
    return {
      code: "NO_ELIGIBLE_BUDDY",
      to_function: "people",
      to_person_id: toPersonId,
      to_person_name: toPersonName,
      summary: `No policy-eligible buddy is available for ${joiner.preferred_name}; People must arrange support by hand.`,
      evidence: ["buddy_directory.list_eligible=[]"],
    };
  }
  return {
    code: "NO_AVAILABLE_BUDDY",
    to_function: "people",
    to_person_id: toPersonId,
    to_person_name: toPersonName,
    summary: `No eligible buddy has two known, non-overlapping first-week slots for ${joiner.preferred_name}; People must verify availability or arrange support by hand.`,
    evidence: candidates
      .filter((assessment) => assessment.eligibility.eligible)
      .map((assessment) => `buddy=${assessment.candidate.id};availability=${assessment.availability.status}`),
  };
}

export function assessBuddyAvailability(
  joiner: Joiner,
  candidates: BuddyCandidate[],
  snapshots: BuddyCalendarSnapshot[],
  startDate = joiner.start_date,
  capacityExemptions: ReadonlySet<string> = new Set(),
): BuddyAvailabilityResult {
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.buddy_id, snapshot]));
  const eligible = eligibleBuddies(joiner, candidates, capacityExemptions);
  const eligibleIds = new Set(eligible.map((candidate) => candidate.id));
  const orderedCandidates = [...eligible, ...candidates.filter((candidate) => !eligibleIds.has(candidate.id))];
  const assessments = orderedCandidates.map((candidate) => {
    const eligibility = assessBuddyEligibility(joiner, candidate, capacityExemptions);
    return {
      candidate: candidateSummary(candidate),
      eligibility,
      availability: assessAvailability(candidate, eligibility, snapshotById.get(candidate.id), startDate),
    };
  });
  const recommended = assessments.find((assessment) => assessment.eligibility.eligible && assessment.availability.status === "available");
  const recommendation = recommended
    ? {
        candidate_id: recommended.candidate.id,
        candidate_name: recommended.candidate.full_name,
        reason: `${recommended.candidate.full_name} is eligible, has ${recommended.candidate.active_buddies} active buddy${recommended.candidate.active_buddies === 1 ? "" : "ies"}, and has two known first-week slots.`,
        slots: recommended.availability.slots,
      }
    : null;
  const eligibleCount = assessments.filter((assessment) => assessment.eligibility.eligible).length;
  return {
    joiner_id: joiner.id,
    start_date: startDate,
    commitment: BUDDY_COMMITMENT,
    candidates: assessments,
    recommendation,
    escalation: recommendation ? null : escalationFor(joiner, assessments, eligibleCount),
  };
}
