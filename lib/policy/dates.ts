// Working-day arithmetic. Deterministic, timezone-free: dates are ISO calendar dates
// (YYYY-MM-DD) treated as UTC midnights. Public holidays are not modelled in v1; that is
// listed in the README as a known gap, not hidden.

export const toDate = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const isWeekend = (d: Date): boolean => {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
};

export function addWorkingDays(iso: string, n: number): string {
  const d = toDate(iso);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    if (!isWeekend(d)) remaining -= 1;
  }
  return toIsoDate(d);
}

export const subtractWorkingDays = (iso: string, n: number): string => addWorkingDays(iso, -n);

// The last Wednesday strictly before the given date.
export function wednesdayBefore(iso: string): string {
  const d = toDate(iso);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() !== 3);
  return toIsoDate(d);
}

// End of the working day, 17:00 UTC, as the datetime a task is due.
export const endOfDay = (iso: string): string => `${iso}T17:00:00Z`;

export const hoursAfter = (isoDatetime: string, hours: number): string =>
  new Date(new Date(isoDatetime).getTime() + hours * 3_600_000).toISOString();

export const isBefore = (a: string, b: string): boolean => new Date(a).getTime() < new Date(b).getTime();
