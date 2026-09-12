import type { Case, HrisEvent, Joiner, Step } from "@/lib/types";
import { buildPlan, rebuildForNewStartDate, resetIds } from "@/lib/plan";
import { buildContract } from "@/lib/contract";
import { deriveState } from "@/lib/state-machine";

// In-memory case store with idempotency on event_id. Demo state lives here and in the
// trail; nothing is written to a real system.

export interface OpenResult {
  outcome: "opened" | "duplicate" | "rejected" | "unknown_joiner";
  case?: Case;
  reason?: string;
}

export class CaseStore {
  private cases = new Map<string, Case>();
  private seenEvents = new Map<string, string>(); // event_id -> case_id
  readonly contracts = new Map<string, ReturnType<typeof buildContract>>();

  constructor() {
    resetIds();
  }

  private step(c: Case, actor: Step["actor"], kind: string, summary: string, at: string, data?: Record<string, unknown>) {
    c.steps.push({ id: `${c.id}-S-${String(c.steps.length + 1).padStart(4, "0")}`, case_id: c.id, at, actor, kind, summary, data });
  }

  open(event: HrisEvent, joiner: Joiner | undefined, now: string): OpenResult {
    const seen = this.seenEvents.get(event.event_id);
    if (seen) {
      const c = this.cases.get(seen)!;
      this.step(c, "system", "event.duplicate", `Event ${event.event_id} delivered again; ignored (idempotency key matched).`, now, {
        event_id: event.event_id,
        redelivery: event.payload.redelivery ?? false,
      });
      c.escalations.push({
        id: `${c.id}-E-dup-${event.event_id}`,
        case_id: c.id,
        code: "DUPLICATE_EVENT",
        severity: "info",
        to_function: "it",
        summary: `Duplicate delivery of ${event.event_id}. No action taken.`,
        evidence: [event.event_id],
        raised_at: now,
        resolved_at: now,
        resolved_by: "system",
      });
      return { outcome: "duplicate", case: c, reason: "event_id already processed" };
    }
    if (!joiner) return { outcome: "unknown_joiner", reason: `No joiner ${event.joiner_id}` };

    const id = `CASE-${joiner.id}`;
    const c: Case = {
      id,
      joiner_id: joiner.id,
      event_id: event.event_id,
      state: "received",
      opened_at: now,
      start_date: joiner.start_date,
      tasks: [],
      escalations: [],
      drafts: [],
      steps: [],
    };
    this.cases.set(id, c);
    this.seenEvents.set(event.event_id, id);
    this.step(c, "system", "event.received", `${event.type} for ${joiner.full_name} (${event.event_id}).`, now, { event_id: event.event_id });

    if (joiner.employment_type !== "employee") {
      c.state = "rejected";
      c.escalations.push({
        id: `${id}-E-0001`,
        case_id: id,
        code: "OUT_OF_SCOPE",
        severity: "warn",
        to_function: "people",
        summary: `${joiner.full_name} is a ${joiner.employment_type}. Day-one readiness v1 covers employees only; routed to People for the contractor process.`,
        evidence: [`hris.employment_type=${joiner.employment_type}`],
        raised_at: now,
      });
      this.step(c, "system", "case.rejected", "Out of scope: contractor.", now);
      return { outcome: "rejected", case: c, reason: "contractor" };
    }

    const contract = buildContract(joiner, id);
    this.contracts.set(id, contract);
    this.step(c, "system", "contract.written", contract.goal, now, { done_when: contract.done_when });

    const plan = buildPlan(joiner, id, now);
    c.tasks = plan.tasks;
    c.escalations.push(...plan.escalations);
    c.steps.push(...plan.steps);
    for (const e of plan.escalations) this.step(c, "system", "escalation.raised", `${e.code}: ${e.summary}`, now, { escalation_id: e.id });
    c.state = deriveState({ ...c, state: "planned" });
    return { outcome: "opened", case: c };
  }

  applyStartDateChange(event: HrisEvent, joiner: Joiner, now: string): { case?: Case; changed: number; unchanged: number; added: number } {
    const seen = this.seenEvents.get(event.event_id);
    if (seen) return { case: this.cases.get(seen), changed: 0, unchanged: 0, added: 0 };
    const c = this.cases.get(`CASE-${joiner.id}`);
    if (!c) return { changed: 0, unchanged: 0, added: 0 };
    this.seenEvents.set(event.event_id, c.id);
    const newStart = String(event.payload.start_date);
    const previous = c.start_date;
    const updated: Joiner = { ...joiner, start_date: newStart };
    const { changed, unchanged, added } = rebuildForNewStartDate(c, updated, now);
    c.tasks.push(...added);
    c.start_date = newStart;
    this.contracts.set(c.id, buildContract(updated, c.id)); // the goal names the start date
    c.escalations.push({
      id: `${c.id}-E-sdc`,
      case_id: c.id,
      code: "START_DATE_CHANGED",
      severity: "info",
      to_function: "people",
      summary: `Start date moved ${previous} -> ${newStart} (${String(event.payload.reason ?? "no reason given")}). ${changed.length} deadlines moved, ${unchanged.length} unchanged, ${added.length} added.`,
      evidence: [event.event_id, ...changed.map((t) => t.id)],
      raised_at: now,
    });
    this.step(c, "system", "plan.recomputed", `Start date ${previous} -> ${newStart}; ${changed.length} tasks re-dated.`, now, {
      changed: changed.map((t) => ({ id: t.id, type: t.type, due_at: t.due_at })),
    });
    c.state = deriveState(c);
    return { case: c, changed: changed.length, unchanged: unchanged.length, added: added.length };
  }

  get(id: string): Case | undefined {
    return this.cases.get(id);
  }
  list(): Case[] {
    return [...this.cases.values()];
  }
}
