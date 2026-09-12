import type { BuddyCalendarSnapshot } from "@/lib/types";

// The checkpoint-A fixture is intentionally a small London slice. It records only
// busy intervals and read state, never private meeting descriptions. The fixed
// UTC+01 offset is valid for this fixture's 9-23 October coverage window. Requests
// whose first working week falls outside that window return unknown.
const LONDON_COVERAGE = {
  coverage_start_date: "2026-10-09",
  coverage_end_date: "2026-10-23",
} as const;

export const BUDDY_CALENDARS: BuddyCalendarSnapshot[] = [
  {
    buddy_id: "b-01",
    captured_at: "2026-09-30T09:00:00Z",
    timezone: "Europe/London",
    utc_offset_minutes: 60,
    ...LONDON_COVERAGE,
    working_hours: { start_local: "09:00", end_local: "17:30" },
    read_status: "known",
    busy_intervals: [
      { start_at: "2026-10-12T09:00:00+01:00", end_at: "2026-10-12T10:00:00+01:00" },
      { start_at: "2026-10-13T12:00:00+01:00", end_at: "2026-10-13T13:00:00+01:00" },
      { start_at: "2026-10-14T15:30:00+01:00", end_at: "2026-10-14T17:30:00+01:00" },
      { start_at: "2026-10-15T10:00:00+01:00", end_at: "2026-10-15T11:30:00+01:00" },
      { start_at: "2026-10-16T14:00:00+01:00", end_at: "2026-10-16T15:00:00+01:00" },
    ],
  },
  {
    buddy_id: "b-02",
    captured_at: "2026-09-30T09:00:00Z",
    timezone: "Europe/London",
    utc_offset_minutes: 60,
    ...LONDON_COVERAGE,
    working_hours: { start_local: "09:00", end_local: "17:30" },
    read_status: "known",
    busy_intervals: [
      { start_at: "2026-10-12T09:00:00+01:00", end_at: "2026-10-12T17:30:00+01:00" },
      { start_at: "2026-10-13T09:00:00+01:00", end_at: "2026-10-13T17:30:00+01:00" },
      { start_at: "2026-10-14T09:00:00+01:00", end_at: "2026-10-14T17:30:00+01:00" },
      { start_at: "2026-10-15T09:00:00+01:00", end_at: "2026-10-15T17:30:00+01:00" },
      { start_at: "2026-10-16T09:00:00+01:00", end_at: "2026-10-16T17:30:00+01:00" },
    ],
  },
  {
    buddy_id: "b-03",
    captured_at: "2026-09-30T09:00:00Z",
    timezone: "Europe/London",
    utc_offset_minutes: 60,
    ...LONDON_COVERAGE,
    working_hours: { start_local: "09:00", end_local: "17:30" },
    read_status: "known",
    busy_intervals: [],
  },
  {
    buddy_id: "b-04",
    captured_at: "2026-09-30T09:00:00Z",
    timezone: "Europe/London",
    utc_offset_minutes: 60,
    ...LONDON_COVERAGE,
    working_hours: { start_local: "09:00", end_local: "17:30" },
    read_status: "unknown",
    busy_intervals: [],
  },
  {
    buddy_id: "b-05",
    captured_at: "2026-09-30T09:00:00Z",
    timezone: "Europe/London",
    utc_offset_minutes: 60,
    ...LONDON_COVERAGE,
    working_hours: { start_local: "09:00", end_local: "17:30" },
    read_status: "known",
    busy_intervals: [],
  },
  {
    buddy_id: "b-06",
    captured_at: "2026-09-30T09:00:00Z",
    timezone: "Europe/London",
    utc_offset_minutes: 60,
    ...LONDON_COVERAGE,
    working_hours: { start_local: "09:00", end_local: "17:30" },
    read_status: "known",
    busy_intervals: [
      { start_at: "2026-10-12T09:00:00+01:00", end_at: "2026-10-12T12:00:00+01:00" },
      { start_at: "2026-10-13T09:00:00+01:00", end_at: "2026-10-13T12:00:00+01:00" },
    ],
  },
  {
    buddy_id: "b-07",
    captured_at: "2026-09-30T09:00:00Z",
    timezone: "Europe/London",
    utc_offset_minutes: 60,
    ...LONDON_COVERAGE,
    working_hours: { start_local: "09:00", end_local: "17:30" },
    read_status: "error",
    busy_intervals: [],
  },
];

export const buddyCalendarById = (buddyId: string): BuddyCalendarSnapshot | undefined =>
  BUDDY_CALENDARS.find((snapshot) => snapshot.buddy_id === buddyId);
