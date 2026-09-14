import { buddyById } from "@/data/buddies";
import { personById } from "@/data/people";
import type { BuddyAvailabilityResult } from "@/lib/policy/buddy-availability";
import type { BuddyRequest, Case, Draft } from "@/lib/types";

export interface AttentionRunProjection {
  case: Case;
  facts: {
    equipment_late: boolean;
    equipment_owner_name: string;
    start_date: string;
  };
  decision?: "approve" | "reject";
  draft: Draft | null;
  draft_unavailable?: unknown;
  buddy: {
    availability: BuddyAvailabilityResult;
    request: BuddyRequest | null;
  };
}

export function attentionSummary(run: AttentionRunProjection) {
  const buddyTask = run.case.tasks.find((task) => task.type === "buddy_allocation");
  const complianceTasks = run.case.tasks.filter((task) => task.compliance_code);
  const openComplianceTasks = complianceTasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const unresolvedEscalations = run.case.escalations.filter((escalation) => !escalation.resolved_at);
  const complianceEscalationCodes = new Set<string>(["RTW_NOT_EVIDENCED", "COMPLIANCE_DEADLINE_AT_RISK"]);
  const unresolvedComplianceEscalations = unresolvedEscalations.filter((escalation) => complianceEscalationCodes.has(escalation.code));
  const primaryComplianceTask = openComplianceTasks.find((task) => task.status === "escalated") ?? openComplianceTasks[0];
  const complianceNextAction = primaryComplianceTask
    ? `${primaryComplianceTask.status === "escalated" ? "Resolve" : "Complete"} ${primaryComplianceTask.title}.`
    : unresolvedComplianceEscalations[0]?.summary ?? "No open compliance task is due by the current start date.";
  const screenState = run.decision
    ? "resolved"
    : run.draft
    ? "awaiting_decision"
    : run.draft_unavailable
    ? "draft_unavailable"
    : "no_action";
  const equipmentStatus = !run.facts.equipment_late
    ? "On track"
    : run.decision === "approve"
    ? "Awaiting IT response"
    : screenState === "draft_unavailable"
    ? "Draft unavailable"
    : screenState === "awaiting_decision"
    ? "Needs approval"
    : run.decision === "reject"
    ? "Nudge rejected"
    : "Needs review";
  const equipmentNextAction = !run.facts.equipment_late
    ? "No equipment action required from the current dates."
    : run.decision === "approve"
    ? "Wait for IT to arrange a loaner or earlier delivery."
    : run.decision === "reject"
    ? "Nothing was sent. Chase IT by hand, or change the start date so the assistant reassesses."
    : screenState === "draft_unavailable"
    ? "Run the assistant again before any message can be sent."
    : "Approve or reject the equipment nudge.";

  let buddyStatus = "Ready for review";
  let buddyNextAction = run.buddy.availability.recommendation
    ? "Compare candidates and request support."
    : run.buddy.availability.escalation?.summary ?? "People must review buddy support by hand.";
  if (run.buddy.request?.status === "pending_approval") {
    buddyStatus = "Awaiting approval";
    buddyNextAction = "Approve or reject the exact buddy request.";
  } else if (run.buddy.request?.status === "awaiting_acceptance") {
    buddyStatus = "Awaiting buddy acceptance";
    buddyNextAction = "Use the labelled simulation response control.";
  } else if (run.buddy.request?.status === "accepted" && buddyTask?.status !== "done") {
    buddyStatus = "Awaiting People confirmation";
    buddyNextAction = "Confirm the accepted allocation as People.";
  } else if (run.buddy.request?.status === "confirmed" && buddyTask?.status === "done") {
    buddyStatus = "Confirmed";
    buddyNextAction = "People confirmation is recorded for this case.";
  } else if (run.buddy.request?.status === "declined" || run.buddy.request?.status === "rejected") {
    // Reached only when no replacement request is pending: the latest request is the declined or
    // rejected one, so the guidance depends on whether a current candidate exists.
    buddyStatus = "Needs replacement";
    buddyNextAction = run.buddy.availability.recommendation
      ? `Prepare a replacement request for ${run.buddy.availability.recommendation.candidate_name}.`
      : run.buddy.availability.escalation?.summary ?? "No eligible candidate in the current snapshot; People to arrange a buddy by hand.";
  } else if (run.buddy.request?.status === "superseded") {
    buddyStatus = "Needs revalidation";
    buddyNextAction = run.buddy.availability.recommendation
      ? `Prepare a fresh request for ${run.buddy.availability.recommendation.candidate_name} from the current availability.`
      : run.buddy.availability.escalation?.summary ?? "No eligible candidate in the current snapshot; People to arrange a buddy by hand.";
  }

  return {
    equipment: {
      status: equipmentStatus,
      owner_name: run.facts.equipment_owner_name,
      next_action: equipmentNextAction,
    },
    buddy: {
      status: buddyStatus,
      owner_name: personById(buddyTask?.owner_id ?? "")?.full_name ?? buddyTask?.owner_id ?? "People",
      next_action: buddyNextAction,
      candidate_name: run.buddy.request
        ? buddyById(run.buddy.request.candidate_id)?.full_name ?? run.buddy.request.candidate_id
        : run.buddy.availability.recommendation?.candidate_name ?? null,
    },
    compliance: {
      status: unresolvedComplianceEscalations.some((escalation) => escalation.severity === "critical")
        ? "Blocked"
        : openComplianceTasks.length > 0
        ? "In progress"
        : "Complete",
      owner_name: personById(primaryComplianceTask?.owner_id ?? unresolvedComplianceEscalations[0]?.to_person_id ?? "")?.full_name ?? "People",
      next_action: complianceNextAction,
      open_tasks: openComplianceTasks.length,
      total_tasks: complianceTasks.length,
      unresolved_escalations: unresolvedComplianceEscalations.length,
    },
  };
}
