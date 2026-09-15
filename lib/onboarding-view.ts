import type { Case, Joiner } from "@/lib/types";
import { personById, OWNER_BY_FUNCTION_AND_COUNTRY } from "@/data/people";
import { accessRowsFor } from "@/lib/policy/access";
import { accessRequests } from "@/lib/connectors/simulated/identity";

// A minimum-field observation shared by the UI and the read-only assistant.
// Existing task state is evidence of planned work, not proof of delivery or account creation.
export function onboardingView(c: Case, joiner: Joiner) {
  const tasks = c.tasks.map((task) => ({
    id: task.id, type: task.type, title: task.title, status: task.status,
    due_at: task.due_at, owner_name: personById(task.owner_id)?.full_name ?? task.owner_id,
    owner_function: task.owner_function,
  }));
  const manager = personById(joiner.manager_id);
  const managerPlan = [...(c.manager_plans ?? [])].reverse().find((plan) => plan.status === "confirmed" && plan.start_date === c.start_date);
  const latestManagerPlan = c.manager_plans?.at(-1) ?? null;
  return {
    profile: {
      name: joiner.full_name, preferred_name: joiner.preferred_name, title: joiner.title,
      team: joiner.team, office: joiner.office, work_mode: joiner.work_mode,
      start_date: c.start_date, manager_name: manager?.full_name ?? "Not recorded",
      setup: tasks.filter((task) => task.type === "hris_profile"),
    },
    access: accessRowsFor(joiner).map((row) => {
      const task = c.tasks.find((item) => item.type === "access_request" && item.system === row.system);
      const request = accessRequests.find((item) => item.joiner_id === joiner.id && item.system === row.system && item.level === row.level);
      const approverId = row.approver === "manager" ? joiner.manager_id : OWNER_BY_FUNCTION_AND_COUNTRY[row.approver][joiner.country];
      return {
        system: row.system, level: row.level, approver_name: personById(approverId)?.full_name ?? row.approver,
        owner_name: task ? personById(task.owner_id)?.full_name ?? task.owner_id : "Not assigned",
        due_at: task?.due_at ?? null, task_status: task?.status ?? null,
        request_id: request?.id ?? null, request_status: request?.status ?? "not_submitted",
      };
    }),
    manager: {
      name: manager?.full_name ?? "Not recorded",
      tasks: tasks.filter((task) => task.owner_function === "manager"),
      escalations: c.escalations.filter((item) => item.code === "MANAGER_UNAVAILABLE" && !item.resolved_at).map((item) => item.summary),
      coordination: latestManagerPlan ? {
        request_id: latestManagerPlan.id,
        status: latestManagerPlan.status,
        start_date: latestManagerPlan.start_date,
        manager_name: personById(latestManagerPlan.manager_id)?.full_name ?? latestManagerPlan.manager_id,
        sent_at: latestManagerPlan.sent_at ?? null,
        response_at: latestManagerPlan.response_at ?? null,
        confirmed_at: latestManagerPlan.confirmed_at ?? null,
      } : null,
    },
    tasks,
    first_day: {
      start_date: c.start_date, office: joiner.office, work_mode: joiner.work_mode,
      manager_name: manager?.full_name ?? "Not recorded",
      people_contact: personById(OWNER_BY_FUNCTION_AND_COUNTRY.people[joiner.country])?.full_name ?? "People team",
      arrival_time: managerPlan?.arrival_time ?? null,
      office_address: managerPlan?.meeting_place ?? null,
      items_to_bring: managerPlan?.items_to_bring ?? null,
      outline: managerPlan?.first_day_outline ?? null,
      confirmed_plan_id: managerPlan?.id ?? null,
    },
  };
}

export type OnboardingView = ReturnType<typeof onboardingView>;
