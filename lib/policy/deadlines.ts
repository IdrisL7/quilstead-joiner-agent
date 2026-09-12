import type { ComplianceCode, Country, Joiner, TaskType } from "@/lib/types";
import { addWorkingDays, subtractWorkingDays, wednesdayBefore, endOfDay } from "./dates";

// Country rules as code. Every deadline a task carries comes from here, never from the
// model. Offsets are in working days relative to the start date (S) or the contract (C).

export interface PlannedItem {
  type: TaskType;
  title: string;
  owner_function: "people" | "it" | "manager" | "finance";
  due_at: string;
  compliance_code?: ComplianceCode;
  detail?: string;
}

// Days before start at which an unevidenced right-to-work check becomes an escalation.
export const RTW_AT_RISK_WORKING_DAYS = 5;
// Access requests must be filed this many working days before start.
export const ACCESS_LEAD_WORKING_DAYS = 2;
// Buddy allocated this many working days before start.
export const BUDDY_LEAD_WORKING_DAYS = 3;
// Remote joiners' equipment ships this many working days before start.
export const SHIP_LEAD_WORKING_DAYS = 3;

export function commonItems(j: Joiner): PlannedItem[] {
  const S = j.start_date;
  const C = j.contract_signed_at.slice(0, 10);
  const items: PlannedItem[] = [
    { type: "hris_profile", title: "Complete HRIS profile", owner_function: "people", due_at: endOfDay(addWorkingDays(C, 1)) },
    {
      type: "esign_pack",
      title: "Send pre-start forms pack for signature",
      owner_function: "people",
      due_at: endOfDay(subtractWorkingDays(S, 3)),
      detail: "Sent only after a named person approves the pack.",
    },
    {
      type: "equipment_order",
      title: `Order ${j.equipment_preference.replace(/_/g, " ")}`,
      owner_function: "it",
      due_at: endOfDay(addWorkingDays(C, 5)),
      detail:
        j.work_mode === "remote"
          ? `Ship to home address by ${subtractWorkingDays(S, SHIP_LEAD_WORKING_DAYS)}; record tracking number.`
          : "Collect from reception on the first morning.",
    },
    { type: "slack_invite", title: "Invite to Slack workspace and team channels", owner_function: "it", due_at: endOfDay(subtractWorkingDays(S, 1)) },
    { type: "buddy_allocation", title: "Allocate buddy", owner_function: "people", due_at: endOfDay(subtractWorkingDays(S, BUDDY_LEAD_WORKING_DAYS)) },
    { type: "manager_day_one_plan", title: "Confirm first-day plan", owner_function: "manager", due_at: endOfDay(wednesdayBefore(S)) },
    { type: "welcome_message", title: "Welcome message to joiner (draft for approval)", owner_function: "people", due_at: endOfDay(subtractWorkingDays(S, 1)) },
  ];
  return items;
}

export function countryItems(j: Joiner): PlannedItem[] {
  const S = j.start_date;
  switch (j.country) {
    case "UK":
      return [
        {
          type: "right_to_work",
          title: "Right to work check evidenced in HRIS",
          owner_function: "people",
          due_at: endOfDay(subtractWorkingDays(S, 1)),
          compliance_code: "UK_RTW",
          detail: `Escalates if not evidenced ${RTW_AT_RISK_WORKING_DAYS} working days before start.`,
        },
      ];
    case "US":
      return [
        { type: "i9_section_1", title: "Form I-9 Section 1 completed by joiner", owner_function: "people", due_at: endOfDay(S), compliance_code: "US_I9_S1" },
        { type: "i9_section_2", title: "Form I-9 Section 2 completed by People", owner_function: "people", due_at: endOfDay(addWorkingDays(S, 3)), compliance_code: "US_I9_S2" },
        { type: "tax_forms", title: "Federal and state tax forms", owner_function: "people", due_at: endOfDay(addWorkingDays(S, 5)) },
      ];
    case "DE":
      return [
        {
          type: "works_council_notice",
          title: "Works council notified of hire",
          owner_function: "people",
          due_at: endOfDay(subtractWorkingDays(S, 5)),
          compliance_code: "DE_WORKS_COUNCIL",
        },
        {
          type: "social_insurance_registration",
          title: "Social insurance registration and tax ID recorded",
          owner_function: "people",
          due_at: endOfDay(S),
          compliance_code: "DE_SOCIAL_INSURANCE",
        },
        {
          type: "right_to_work",
          title: "Residence and work status evidenced in HRIS",
          owner_function: "people",
          due_at: endOfDay(subtractWorkingDays(S, 1)),
          compliance_code: "DE_RTW",
          detail: `Escalates if not evidenced ${RTW_AT_RISK_WORKING_DAYS} working days before start.`,
        },
      ];
  }
}

export const rtwAtRiskDate = (startDate: string): string => subtractWorkingDays(startDate, RTW_AT_RISK_WORKING_DAYS);

export const countryLabel: Record<Country, string> = { UK: "United Kingdom", US: "United States", DE: "Germany" };
