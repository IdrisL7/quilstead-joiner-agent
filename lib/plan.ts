import type { Case, Escalation, Joiner, Person, Step, Task, TaskStatus } from "./types";
import { commonItems, countryItems, rtwAtRiskDate, ACCESS_LEAD_WORKING_DAYS } from "./policy/deadlines";
import { subtractWorkingDays, endOfDay, isBefore } from "./policy/dates";
import { accessRowsFor } from "./policy/access";
import { eligibleBuddies } from "./policy/buddy";
import { OWNER_BY_FUNCTION_AND_COUNTRY, SLA_HOURS, personById } from "@/data/people";
import { BUDDIES } from "@/data/buddies";

// Deterministic plan builder. Given a joiner and "now", returns the tasks with owners and
// due dates, plus the escalations that policy raises on its own. No model involvement.

export interface PlanResult {
  tasks: Task[];
  escalations: Escalation[];
  steps: Step[];
  manager: Person | undefined;
  manager_effective: Person | undefined; // deputy when the manager is on leave
  eligible_buddy_ids: string[];
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${String(++seq).padStart(4, "0")}`;
export const resetIds = () => {
  seq = 0;
};

function statusAt(due_at: string, now: string): TaskStatus {
  return isBefore(due_at, now) ? "overdue" : "open";
}

export function managerFor(j: Joiner, now: string): { manager?: Person; effective?: Person; onLeave: boolean } {
  const manager = personById(j.manager_id);
  if (!manager) return { manager: undefined, effective: undefined, onLeave: false };
  const today = now.slice(0, 10);
  const onLeave = !!manager.on_leave_until && manager.on_leave_until >= today;
  const effective = onLeave && manager.deputy_id ? personById(manager.deputy_id) ?? manager : manager;
  return { manager, effective, onLeave };
}

export function buildPlan(j: Joiner, caseId: string, now: string): PlanResult {
  const steps: Step[] = [];
  const escalations: Escalation[] = [];
  const tasks: Task[] = [];
  const { manager, effective, onLeave } = managerFor(j, now);

  const ownerFor = (fn: "people" | "it" | "manager" | "finance"): string => {
    if (fn === "manager") return effective?.id ?? j.manager_id;
    return OWNER_BY_FUNCTION_AND_COUNTRY[fn][j.country];
  };

  for (const item of [...countryItems(j), ...commonItems(j)]) {
    const owner_id = ownerFor(item.owner_function);
    tasks.push({
      id: nextId(`${caseId}-T`),
      case_id: caseId,
      type: item.type,
      title: item.title,
      owner_id,
      owner_function: item.owner_function,
      due_at: item.due_at,
      sla_hours: SLA_HOURS[item.type] ?? 48,
      status: statusAt(item.due_at, now),
      compliance_code: item.compliance_code,
      detail: item.detail,
      created_by: "agent",
    });
  }

  // One access request per matrix row. Filed, never granted.
  const accessDue = endOfDay(subtractWorkingDays(j.start_date, ACCESS_LEAD_WORKING_DAYS));
  for (const row of accessRowsFor(j)) {
    tasks.push({
      id: nextId(`${caseId}-T`),
      case_id: caseId,
      type: "access_request",
      title: `Request ${row.level} access to ${row.system.replace(/_/g, " ")}`,
      owner_id: ownerFor("it"),
      owner_function: "it",
      due_at: accessDue,
      sla_hours: SLA_HOURS.access_request,
      status: statusAt(accessDue, now),
      system: row.system,
      detail: `Approver per matrix: ${row.approver}. Filed as a request in the identity provider; approval stays with the approver.`,
      created_by: "agent",
    });
  }

  steps.push({
    id: nextId(`${caseId}-S`),
    case_id: caseId,
    at: now,
    actor: "system",
    kind: "plan.built",
    summary: `${tasks.length} tasks planned from ${j.country} rules for start ${j.start_date}.`,
    data: { task_count: tasks.length, compliance_items: tasks.filter((t) => t.compliance_code).map((t) => t.compliance_code) },
  });

  // Policy-raised escalations.
  const rtwTask = tasks.find((t) => t.type === "right_to_work");
  if (rtwTask && j.right_to_work.status !== "evidenced" && now.slice(0, 10) >= rtwAtRiskDate(j.start_date)) {
    escalations.push({
      id: nextId(`${caseId}-E`),
      case_id: caseId,
      code: "RTW_NOT_EVIDENCED",
      severity: "critical",
      to_function: "people",
      to_person_id: ownerFor("people"),
      summary: `Right to work for ${j.preferred_name} is ${j.right_to_work.status} with start on ${j.start_date}. At-risk date ${rtwAtRiskDate(j.start_date)} reached. Start date on hold until evidenced by a named person.`,
      evidence: [rtwTask.id, `hris.right_to_work.status=${j.right_to_work.status}`],
      raised_at: now,
    });
    rtwTask.status = "escalated";
  }

  if (onLeave && manager && effective && effective.id !== manager.id) {
    escalations.push({
      id: nextId(`${caseId}-E`),
      case_id: caseId,
      code: "MANAGER_UNAVAILABLE",
      severity: "info",
      to_function: "people",
      to_person_id: ownerFor("people"),
      summary: `${manager.full_name} is on leave until ${manager.on_leave_until}. Manager tasks routed to deputy ${effective.full_name}.`,
      evidence: [`people.${manager.id}.on_leave_until=${manager.on_leave_until}`, `deputy=${effective.id}`],
      raised_at: now,
    });
  }

  const eligible = eligibleBuddies(j, BUDDIES);
  if (eligible.length === 0) {
    const buddyTask = tasks.find((t) => t.type === "buddy_allocation");
    escalations.push({
      id: nextId(`${caseId}-E`),
      case_id: caseId,
      code: "NO_ELIGIBLE_BUDDY",
      severity: "warn",
      to_function: "people",
      to_person_id: ownerFor("people"),
      summary: `No eligible buddy for ${j.preferred_name} (${j.office}, ${j.work_mode}). Policy filter returned nobody; People Partner to arrange by hand.`,
      evidence: [buddyTask?.id ?? "buddy_allocation", "buddy_directory.list_eligible=[]"],
      raised_at: now,
    });
    if (buddyTask) buddyTask.status = "escalated";
  }

  return { tasks, escalations, steps, manager, manager_effective: effective, eligible_buddy_ids: eligible.map((b) => b.id) };
}

// Recompute after a start-date change: only tasks whose due date moved are reopened.
export function rebuildForNewStartDate(existing: Case, j: Joiner, now: string): { changed: Task[]; unchanged: Task[]; added: Task[] } {
  const fresh = buildPlan({ ...j }, existing.id, now);
  const changed: Task[] = [];
  const unchanged: Task[] = [];
  const added: Task[] = [];
  for (const f of fresh.tasks) {
    const match = existing.tasks.find((t) => t.type === f.type && t.system === f.system);
    if (!match) {
      added.push(f);
      continue;
    }
    if (match.due_at !== f.due_at) {
      const wasDone = match.status === "done";
      match.due_at = f.due_at;
      match.status = wasDone ? "done" : statusAt(f.due_at, now);
      changed.push(match);
    } else {
      unchanged.push(match);
    }
  }
  return { changed, unchanged, added };
}
