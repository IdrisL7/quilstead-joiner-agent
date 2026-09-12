import type { Case, CaseState } from "./types";

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

// Derived: a case is blocked while any critical escalation is unresolved.
export function deriveState(c: Case): CaseState {
  if (c.state === "rejected" || c.state === "closed") return c.state;
  const critical = c.escalations.some((e) => e.severity === "critical" && !e.resolved_at);
  if (critical) return "blocked";
  const open = c.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  if (open.length === 0) return "ready_for_day_one";
  return c.state === "received" ? "planned" : "in_progress";
}
