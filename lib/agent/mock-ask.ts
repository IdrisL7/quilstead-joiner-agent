import { randomUUID } from "node:crypto";
import { buddyById } from "@/data/buddies";
import type {
  AgentContentBlock,
  AgentMessage,
  AgentModel,
  AgentTrigger,
  ModelTurn,
} from "./types";
import type { Case, Joiner, ToolResult } from "@/lib/types";

export type AskIntent = "status" | "equipment" | "buddy" | "compliance" | "owner" | "unmatched";

interface MockAskContext {
  case: Case;
  joiner: Joiner;
  trigger: AgentTrigger;
  question: string;
}

interface CaseTaskRow {
  type: string;
  title: string;
  status: string;
  due_at: string;
  owner_id: string;
  owner_name: string;
  compliance_code?: string | null;
}

interface CaseStateData {
  start_date: string;
  tasks: CaseTaskRow[];
  open_escalations: Array<{ code: string; summary: string }>;
  drafts: Array<{ kind: string; status: string; pending: boolean }>;
  buddy_requests: Array<{
    candidate_id: string;
    candidate_name?: string;
    status: string;
    slots?: Array<{ kind: string; start_at: string; end_at: string; timezone: string }>;
  }>;
}

interface EquipmentData {
  late: boolean;
  eta: string;
  owner_name: string;
}

interface AvailabilityData {
  recommendation: { candidate_id: string; candidate_name: string; slots: Array<{ kind: string; start_at: string; end_at: string; timezone: string }> } | null;
}

function toolUse(name: string, input: Record<string, unknown> = {}): AgentContentBlock {
  return { type: "tool_use", id: `mock-ask-${randomUUID()}`, name, input };
}

function resultsFrom(messages: AgentMessage[]): { name: string; result: ToolResult }[] {
  return messages.flatMap((message) => {
    if (!Array.isArray(message.content)) return [];
    return message.content.flatMap((block) => block.type === "tool_result" ? [{ name: block.name, result: block.result }] : []);
  });
}

function latestResult(messages: AgentMessage[], name: string): ToolResult | undefined {
  return resultsFrom(messages).filter((entry) => entry.name === name).at(-1)?.result;
}

function dataFrom<T>(result: ToolResult | undefined): T | null {
  return result && result.status !== "error" && result.status !== "denied" && result.data && typeof result.data === "object"
    ? result.data as T
    : null;
}

export function askIntentFor(question: string): AskIntent {
  const text = question.toLowerCase();
  if (/(compliance|right to work|i-9|i9|works council|social insurance)/i.test(text)) return "compliance";
  if (/(buddy|new starter support)/i.test(text)) return "buddy";
  if (/(laptop|equipment|eta|delivery|loaner|sorted)/i.test(text)) return "equipment";
  if (/(owner|who is responsible|who owns)/i.test(text)) return "owner";
  if (/(what('?s| is|s)? left|remaining|before day one|tasks?|readiness|ready)/i.test(text)) return "status";
  return "unmatched";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value.includes("T") ? value : `${value}T00:00:00Z`));
}

function formatSlot(slot: { start_at: string; end_at: string; timezone: string }): string {
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
  return `${date}, ${time(slot.start_at)} to ${time(slot.end_at)} (${slot.timezone})`;
}

function isOpen(status: string): boolean {
  return !["done", "cancelled"].includes(status);
}

function statusAnswer(data: CaseStateData): string {
  const open = data.tasks.filter((task) => isOpen(task.status));
  const groups = new Map<string, CaseTaskRow[]>();
  for (const task of open) groups.set(task.owner_name, [...(groups.get(task.owner_name) ?? []), task]);
  const owners = [...groups.entries()].map(([owner, tasks]) => {
    const next = [...tasks].sort((left, right) => Date.parse(left.due_at) - Date.parse(right.due_at))[0];
    return `${owner}: ${tasks.length} open, ${next.title} due ${formatDate(next.due_at)}`;
  });
  const next = [...open].sort((left, right) => Date.parse(left.due_at) - Date.parse(right.due_at))[0];
  if (owners.length === 0) return `Nothing is currently open before ${formatDate(data.start_date)}. The case is ready for People to confirm the remaining evidence.`;
  return `${open.length} tasks remain before ${formatDate(data.start_date)}. ${owners.join("; ")}. Next: ${next.title} with ${next.owner_name}.`;
}

function equipmentAnswer(data: CaseStateData, equipment: EquipmentData | null, joiner: Joiner): string {
  if (!equipment) return "I could not read the laptop order from the current case.";
  const pending = data.drafts.some((draft) => draft.kind === "nudge" && draft.pending);
  const status = equipment.late
    ? `The equipment risk remains because the ETA is after the ${formatDate(data.start_date)} start.`
    : `The ETA is before the ${formatDate(data.start_date)} start, so the equipment is on track.`;
  const action = pending ? "A nudge is awaiting People approval." : equipment.late ? "IT should arrange a loaner or earlier delivery." : "No equipment message is needed.";
  return `Laptop for ${joiner.preferred_name}: ETA ${formatDate(equipment.eta)}, owner ${equipment.owner_name}. ${status} ${action}`;
}

function buddyStatus(status: string): string {
  if (status === "pending_approval") return "awaiting People approval";
  if (status === "awaiting_acceptance") return "awaiting the buddy's response";
  if (status === "accepted") return "accepted and awaiting People confirmation";
  if (status === "confirmed") return "confirmed";
  if (status === "declined") return "declined";
  if (status === "superseded") return "superseded by current facts";
  return status.replaceAll("_", " ");
}

function buddyAnswer(data: CaseStateData, availability: AvailabilityData | null): string {
  const request = [...data.buddy_requests].at(-1);
  const recommendation = availability?.recommendation;
  const candidateName = request?.candidate_name
    ?? (request ? buddyById(request.candidate_id)?.full_name : undefined)
    ?? recommendation?.candidate_name;
  if (!candidateName) return "No buddy is currently recommended from the available calendar snapshot.";
  const status = request ? `The request is ${buddyStatus(request.status)}.` : "No buddy request has been prepared yet.";
  const slots = request?.slots?.length ? request.slots : recommendation?.slots ?? [];
  const slotText = slots.length > 0 ? ` Proposed slots: ${slots.slice(0, 2).map(formatSlot).join("; ")}.` : " No confirmed slots are available in the current snapshot.";
  return `Buddy: ${candidateName}. ${status}${slotText}`;
}

function complianceAnswer(data: CaseStateData): string {
  const tasks = data.tasks.filter((task) => isOpen(task.status) && !!task.compliance_code);
  const escalations = data.open_escalations.filter((escalation) => /RTW|I9|COMPLIANCE|WORKS|SOCIAL/i.test(escalation.code));
  if (tasks.length === 0 && escalations.length === 0) return "No open compliance task or compliance escalation is recorded in this case.";
  const taskText = tasks.map((task) => `${task.title} owned by ${task.owner_name}, due ${formatDate(task.due_at)}`).join("; ");
  const escalationText = escalations.length > 0 ? ` Escalation: ${escalations[0].summary}` : "";
  return `Compliance attention: ${taskText || "no open task"}.${escalationText} The assistant cannot complete compliance work.`;
}

function ownerAnswer(data: CaseStateData, question: string): string {
  const words = question.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 3 && !["what", "which", "does", "have", "task", "tasks", "owner", "owns", "responsible"].includes(word));
  const task = data.tasks.find((candidate) => words.some((word) => `${candidate.title} ${candidate.type}`.toLowerCase().includes(word)));
  if (!task) return "I can identify an owner only for a task named in the current case. Open Activity to inspect the task ledger.";
  return `${task.title} is owned by ${task.owner_name}. It is ${task.status.replaceAll("_", " ")} and due ${formatDate(task.due_at)}.`;
}

export const UNMATCHED_ASK_ANSWER = "I can only answer from this case. Try: What's left before day one? Is the laptop sorted? Who is the buddy? Any compliance risk?";

function answerFor(context: MockAskContext, messages: AgentMessage[]): string {
  const state = dataFrom<CaseStateData>(latestResult(messages, "get_case_state")) ?? {
    start_date: context.case.start_date,
    tasks: [],
    open_escalations: [],
    drafts: [],
    buddy_requests: [],
  };
  const intent = askIntentFor(context.question);
  if (intent === "equipment") return equipmentAnswer(state, dataFrom<EquipmentData>(latestResult(messages, "check_equipment")), context.joiner);
  if (intent === "buddy") return buddyAnswer(state, dataFrom<AvailabilityData>(latestResult(messages, "get_buddy_availability")));
  if (intent === "compliance") return complianceAnswer(state);
  if (intent === "owner") return ownerAnswer(state, context.question);
  if (intent === "status") return statusAnswer(state);
  return UNMATCHED_ASK_ANSWER;
}

export function createMockAskModel(context: MockAskContext): AgentModel {
  return {
    provider: "mock",
    model: "deterministic-ask-model",
    async complete(messages: AgentMessage[]): Promise<ModelTurn> {
      const seen = new Set(resultsFrom(messages).map((entry) => entry.name));
      if (!seen.has("get_case_state")) return { content: [toolUse("get_case_state")] };
      const intent = askIntentFor(context.question);
      if (intent === "equipment" && !seen.has("check_equipment")) return { content: [toolUse("check_equipment")] };
      if (intent === "buddy" && !seen.has("get_buddy_availability")) return { content: [toolUse("get_buddy_availability")] };
      if (!seen.has("finish")) return { content: [toolUse("finish", { next_action: answerFor(context, messages) })] };
      return { content: [{ type: "text", text: "Ask Athena already finished this question." }] };
    },
  };
}
