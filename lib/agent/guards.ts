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

function readableDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`))
    .replace(",", "");
}

function dateTokens(text: string): string[] {
  return [
    ...(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []),
    ...(text.match(/\b\d{1,2}\s+[A-Z][a-z]{2,9}\b/g) ?? []).map((value) => value.replace(/\s+/g, " ")),
  ];
}

function allAllowedDateTokens(context: MessageGuardContext): Set<string> {
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
  return new Set([...dates].flatMap((date) => [date, readableDate(date)]));
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
  const allowed = allAllowedDateTokens(context);
  const invented = dateTokens(body).find((date) => !allowed.has(date));
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
