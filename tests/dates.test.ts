import { describe, it, expect } from "vitest";
import { addWorkingDays, subtractWorkingDays, wednesdayBefore } from "@/lib/policy/dates";

describe("working-day arithmetic", () => {
  it("skips weekends going forward", () => {
    expect(addWorkingDays("2026-10-02", 1)).toBe("2026-10-05"); // Fri -> Mon
    expect(addWorkingDays("2026-10-05", 3)).toBe("2026-10-08");
  });
  it("skips weekends going back", () => {
    expect(subtractWorkingDays("2026-10-05", 1)).toBe("2026-10-02"); // Mon -> Fri
    expect(subtractWorkingDays("2026-10-05", 5)).toBe("2026-09-28");
  });
  it("finds the Wednesday before a Monday start", () => {
    expect(wednesdayBefore("2026-10-05")).toBe("2026-09-30");
    expect(wednesdayBefore("2026-10-01")).toBe("2026-09-30"); // Thursday -> the day before
  });
});
