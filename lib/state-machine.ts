import type { Case, CaseState, Task } from "./types";
import { personById } from "@/data/people";

// Allowed transitions. Anything else throws; the caller records the refusal as a step.
const ALLOWED: Record<CaseState, CaseState[]> = {
  received: ["planned", "rejected"],
  planned: ["in_progress", "blocked", "rejected"],
  in_progress: ["blocked", "ready_for_day_one", "closed"],
  blocked: ["in_progress", "rejected"],
  ready_for_day_one: ["closed", "blocked"],
  closed: [],
  rejected: [],
};

export class IllegalTransition extends Error {
  constructor(from: CaseState, to: CaseState) {
    super(`Illegal case transition ${from} -> ${to}`);
  }
}

export function transition(c: Case, to: CaseState): Case {
  if (!ALLOWED[c.state].includes(to)) throw new IllegalTransition(c.state, to);
  c.state = to;
  return c;
}

const isDueByDayOne = (task: Task, c: Case): boolean => task.due_at.slice(0, 10) <= c.start_date;

const hasNamedHuman = (task: Task): boolean => {
  const person = task.done_by?.trim();
  return !!person && task.done_at !== undefined && person !== "system" && !!personById(person);
};

// Day-one readiness is narrower than "every task is closed": required evidence must
// be recorded by a named human, a buddy must be confirmed, and only tasks due by the
// start date count. Legitimate post-start work can remain open.
export function isReadyForDayOne(c: Case): boolean {
  const dueByDayOne = c.tasks.filter((task) => isDueByDayOne(task, c));
  if (dueByDayOne.some((task) => task.status !== "done" && task.status !== "cancelled")) return false;

  const compliance = dueByDayOne.filter((task) => task.compliance_code);
  if (compliance.some((task) => task.status !== "done" || !hasNamedHuman(task))) return false;

  const buddyTask = c.tasks.find((task) => task.type === "buddy_allocation");
  return !!c.buddy_id && buddyTask?.status === "done" && hasNamedHuman(buddyTask);
}

// Derived: a case is blocked while any critical escalation is unresolved.
export function deriveState(c: Case): CaseState {
  if (c.state === "rejected" || c.state === "closed") return c.state;
  const critical = c.escalations.some((e) => e.severity === "critical" && !e.resolved_at);
  if (critical) return "blocked";
  if (isReadyForDayOne(c)) return "ready_for_day_one";
  return c.state === "received" ? "planned" : "in_progress";
}
