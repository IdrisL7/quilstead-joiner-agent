import type { BuddyAvailabilityResult } from "@/lib/policy/buddy-availability";
import type { Case, DraftKind, Joiner, Task } from "@/lib/types";

export interface MessageProposalInput {
  kind: "nudge" | "buddy_request";
  to: string;
  subject: string;
  body: string;
  reason: string;
  evidence: string[];
}

export interface MessageGuardContext {
  case: Case;
  joiner: Joiner;
  equipmentTask: Task;
  equipmentEta?: string;
  availability: BuddyAvailabilityResult | null;
  allowed_dates: Set<string>;
}

export interface GuardedMessage {
  kind: DraftKind;
  to: string;
  subject: string;
  body: string;
}

export type GuardResult = {
  ok: true;
  message: GuardedMessage;
} | {
  ok: false;
  summary: string;
};

function formatBuddySlot(slot: { kind: string; start_at: string; end_at: string; timezone: string }): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: slot.timezone,
  }).format(new Date(slot.start_at)).replace(",", "");
  const time = (value: string) => new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: slot.timezone,
  }).format(new Date(value));
  return `${slot.kind[0].toUpperCase()}${slot.kind.slice(1)} ${date}, ${time(slot.start_at)} to ${time(slot.end_at)} (${slot.timezone})`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase());
}

// Every date mention the model can write, normalised to ISO. Day-month forms take the year
// from the run's allowed dates; if more than one year is allowed, all are tried.
export function dateTokens(text: string, years: string[]): string[] {
  const found: string[] = [];
  for (const iso of text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []) found.push(iso);
  const pad = (n: string) => n.padStart(2, "0");
  const dayMonth = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\b/g;
  const monthDay = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/g;
  const numeric = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  for (const m of text.matchAll(dayMonth)) for (const y of years) found.push(`${y}-${pad(String(monthIndex(m[2]) + 1))}-${pad(m[1])}`);
  for (const m of text.matchAll(monthDay)) for (const y of years) found.push(`${y}-${pad(String(monthIndex(m[1]) + 1))}-${pad(m[2])}`);
  for (const m of text.matchAll(numeric)) found.push(`${m[3]}-${pad(m[2])}-${pad(m[1])}`);
  return found;
}

function allAllowedDates(context: MessageGuardContext): Set<string> {
  const dates = new Set(context.allowed_dates);
  dates.add(context.case.start_date);
  dates.add(context.joiner.start_date);
  dates.add(context.equipmentTask.due_at.slice(0, 10));
  if (context.equipmentEta) dates.add(context.equipmentEta);
  for (const assessment of context.availability?.candidates ?? []) {
    for (const slot of assessment.availability.slots) {
      dates.add(slot.start_at.slice(0, 10));
      dates.add(slot.end_at.slice(0, 10));
    }
  }
  return dates;
}

// A day-month mention is invented only if it matches no allowed date in any allowed year.
export function inventedDate(body: string, allowed: Set<string>): string | null {
  const years = [...new Set([...allowed].map((d) => d.slice(0, 4)))];
  const mentions = new Map<string, string[]>();
  const record = (raw: string, iso: string) => mentions.set(raw, [...(mentions.get(raw) ?? []), iso]);
  for (const iso of body.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []) record(iso, iso);
  for (const m of body.matchAll(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\b/g)) for (const iso of dateTokens(m[0], years)) record(m[0], iso);
  for (const m of body.matchAll(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b/g)) for (const iso of dateTokens(m[0], years)) record(m[0], iso);
  for (const m of body.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g)) for (const iso of dateTokens(m[0], years)) record(m[0], iso);
  for (const [raw, isos] of mentions) if (!isos.some((iso) => allowed.has(iso))) return raw;
  return null;
}

export function validateMessageProposal(input: MessageProposalInput, context: MessageGuardContext): GuardResult {
  const subject = input.subject.trim();
  const baseBody = input.body.trim();
  if (!subject || subject.length > 160) return { ok: false, summary: "Message refused: subject must be 1-160 characters." };
  if (!baseBody) return { ok: false, summary: "Message refused: body cannot be empty." };
  if (!Array.isArray(input.evidence) || input.evidence.some((item) => typeof item !== "string")) {
    return { ok: false, summary: "Message refused: evidence must be a list of strings." };
  }

  if (input.kind === "nudge") {
    if (input.to !== context.equipmentTask.owner_id) {
      return { ok: false, summary: `Message refused: nudge recipient ${input.to} is not the equipment task owner.` };
    }
    if (!/loaner|earlier delivery/i.test(baseBody)) {
      return { ok: false, summary: "Message refused: equipment nudge must ask for a loaner or earlier delivery." };
    }
  }

  let body = baseBody;
  if (input.kind === "buddy_request") {
    const assessment = context.availability?.candidates.find((candidate) => candidate.candidate.id === input.to);
    if (!assessment || !assessment.eligibility.eligible || assessment.availability.status !== "available") {
      return { ok: false, summary: `Message refused: ${input.to} is not an eligible and available buddy in the latest observation.` };
    }
    if (assessment.availability.slots.length < 2) {
      return { ok: false, summary: "Message refused: buddy request needs two proposed slots from the latest observation." };
    }
    const slotLines = assessment.availability.slots
      .slice(0, 2)
      .map((slot) => `- ${formatBuddySlot(slot)}`)
      .join("\n");
    body = `${baseBody}\n\nProposed slots:\n${slotLines}`;
  }

  if (body.length > 700) return { ok: false, summary: "Message refused: body must be 700 characters or fewer after trusted slots are appended." };
  const invented = inventedDate(body, allAllowedDates(context));
  if (invented) return { ok: false, summary: `Message refused: date ${invented} was not present in this run's facts.` };

  return {
    ok: true,
    message: {
      kind: input.kind === "buddy_request" ? "buddy_intro" : "nudge",
      to: input.to,
      subject,
      body,
    },
  };
}
