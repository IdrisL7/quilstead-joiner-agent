import type { Case, EscalationCode, HrisEvent, Joiner, Step } from "@/lib/types";
import { buildPlan, rebuildForNewStartDate } from "@/lib/plan";
import { buildContract } from "@/lib/contract";
import { deriveState } from "@/lib/state-machine";
import { currentJoinerById, saveCurrentJoiner } from "@/lib/store/joiner-store";

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

  // Construction is side-effect free. Demo and test runners reset shared state explicitly.

  private step(c: Case, actor: Step["actor"], kind: string, summary: string, at: string, data?: Record<string, unknown>) {
    c.steps.push({ id: `${c.id}-S-${String(c.steps.length + 1).padStart(4, "0")}`, case_id: c.id, at, actor, kind, summary, data });
  }

  private recordDuplicate(c: Case, event: HrisEvent, now: string, reason: string): void {
    const escalationId = `${c.id}-E-dup-${event.event_id}`;
    this.step(c, "system", "event.duplicate", `${reason} Event ${event.event_id} ignored.`, now, {
      event_id: event.event_id,
      redelivery: event.payload.redelivery ?? false,
    });
    if (c.escalations.some((e) => e.id === escalationId)) return;
    c.escalations.push({
      id: escalationId,
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
  }

  open(event: HrisEvent, joiner: Joiner | undefined, now: string): OpenResult {
    const seen = this.seenEvents.get(event.event_id);
    if (seen) {
      const c = this.cases.get(seen)!;
      this.recordDuplicate(c, event, now, "Event id already processed.");
      return { outcome: "duplicate", case: c, reason: "event_id already processed" };
    }

    // event_id identifies delivery. CASE-${joiner_id} identifies the hiring case.
    // A new delivery id must never replace a case that already contains progress,
    // approvals or history.
    const caseId = `CASE-${event.joiner_id}`;
    const existing = this.cases.get(caseId);
    if (existing) {
      this.seenEvents.set(event.event_id, existing.id);
      this.recordDuplicate(existing, event, now, "Case identity already exists for this joiner.");
      return { outcome: "duplicate", case: existing, reason: "case already exists for joiner" };
    }
    if (!joiner) return { outcome: "unknown_joiner", reason: `No joiner ${event.joiner_id}` };

    const authoritativeJoiner = currentJoinerById(joiner.id) ?? saveCurrentJoiner(joiner);
    const id = caseId;
    const c: Case = {
      id,
      joiner_id: authoritativeJoiner.id,
      event_id: event.event_id,
      state: "received",
      opened_at: now,
      start_date: authoritativeJoiner.start_date,
      tasks: [],
      escalations: [],
      drafts: [],
      buddy_requests: [],
      steps: [],
    };
    this.cases.set(id, c);
    this.seenEvents.set(event.event_id, id);
    this.step(c, "system", "event.received", `${event.type} for ${joiner.full_name} (${event.event_id}).`, now, { event_id: event.event_id });

    if (authoritativeJoiner.employment_type !== "employee") {
      c.state = "rejected";
      c.escalations.push({
        id: `${id}-E-0001`,
        case_id: id,
        code: "OUT_OF_SCOPE",
        severity: "warn",
        to_function: "people",
        summary: `${authoritativeJoiner.full_name} is a ${authoritativeJoiner.employment_type}. Day-one readiness v1 covers employees only; routed to People for the contractor process.`,
        evidence: [`hris.employment_type=${authoritativeJoiner.employment_type}`],
        raised_at: now,
      });
      this.step(c, "system", "case.rejected", "Out of scope: contractor.", now);
      return { outcome: "rejected", case: c, reason: "contractor" };
    }

    const contract = buildContract(authoritativeJoiner, id);
    this.contracts.set(id, contract);
    this.step(c, "system", "contract.written", contract.goal, now, { done_when: contract.done_when });

    const plan = buildPlan(authoritativeJoiner, id, now);
    c.tasks = plan.tasks;
    c.escalations.push(...plan.escalations);
    c.steps.push(...plan.steps);
    for (const e of plan.escalations) this.step(c, "system", "escalation.raised", `${e.code}: ${e.summary}`, now, { escalation_id: e.id });
    c.state = deriveState({ ...c, state: "planned" });
    return { outcome: "opened", case: c };
  }

  applyStartDateChange(event: HrisEvent, joiner: Joiner, now: string): { case?: Case; changed: number; unchanged: number; added: number; deadlineChanged: number } {
    const seen = this.seenEvents.get(event.event_id);
    if (seen) return { case: this.cases.get(seen), changed: 0, unchanged: 0, added: 0, deadlineChanged: 0 };
    const c = this.cases.get(`CASE-${event.joiner_id}`);
    if (!c) return { changed: 0, unchanged: 0, added: 0, deadlineChanged: 0 };
    this.seenEvents.set(event.event_id, c.id);
    const newStart = String(event.payload.start_date);
    const previous = c.start_date;
    const currentJoiner = currentJoinerById(event.joiner_id) ?? joiner;
    const updated: Joiner = { ...currentJoiner, start_date: newStart };
    saveCurrentJoiner(updated);
    const { changed, unchanged, added, escalations, deadlineChanged } = rebuildForNewStartDate(c, updated, now);
    c.tasks.push(...added);
    c.start_date = newStart;
    this.contracts.set(c.id, buildContract(updated, c.id)); // the goal names the start date

    const policyCodes = new Set<EscalationCode>(["RTW_NOT_EVIDENCED", "MANAGER_UNAVAILABLE", "NO_ELIGIBLE_BUDDY"]);
    const freshByCode = new Map(escalations.map((e) => [e.code, e]));
    for (const existingEscalation of c.escalations) {
      if (!policyCodes.has(existingEscalation.code) || existingEscalation.resolved_at || freshByCode.has(existingEscalation.code)) continue;
      existingEscalation.resolved_at = now;
      existingEscalation.resolved_by = "system";
      this.step(c, "system", "escalation.reconciled", `${existingEscalation.code} cleared after the start-date policy recompute.`, now, {
        escalation_id: existingEscalation.id,
      });
    }
    for (const fresh of escalations) {
      const currentEscalation = c.escalations.find((e) => e.code === fresh.code && !e.resolved_at);
      if (currentEscalation) {
        currentEscalation.severity = fresh.severity;
        currentEscalation.to_function = fresh.to_function;
        currentEscalation.to_person_id = fresh.to_person_id;
        currentEscalation.summary = fresh.summary;
        currentEscalation.evidence = fresh.evidence;
        continue;
      }
      c.escalations.push(fresh);
      this.step(c, "system", "escalation.raised", `${fresh.code}: ${fresh.summary}`, now, { escalation_id: fresh.id });
    }
    c.escalations.push({
      id: `${c.id}-E-sdc-${event.event_id}`,
      case_id: c.id,
      code: "START_DATE_CHANGED",
      severity: "info",
      to_function: "people",
      summary: `Start date moved ${previous} -> ${newStart} (${String(event.payload.reason ?? "no reason given")}). ${deadlineChanged} deadlines moved, ${changed.length} tasks reconciled, ${unchanged.length} unchanged, ${added.length} added.`,
      evidence: [event.event_id, ...changed.map((t) => t.id)],
      raised_at: now,
    });
    this.step(c, "system", "plan.recomputed", `Start date ${previous} -> ${newStart}; ${deadlineChanged} deadlines moved and ${changed.length} tasks reconciled.`, now, {
      changed: changed.map((t) => ({ id: t.id, type: t.type, due_at: t.due_at })),
      deadline_changed: deadlineChanged,
    });
    c.state = deriveState(c);
    return { case: c, changed: changed.length, unchanged: unchanged.length, added: added.length, deadlineChanged };
  }

  get(id: string): Case | undefined {
    return this.cases.get(id);
  }
  list(): Case[] {
    return [...this.cases.values()];
  }
}
