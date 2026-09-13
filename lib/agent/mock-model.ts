import { randomUUID } from "node:crypto";
import { buddyById } from "@/data/buddies";
import type {
  AgentContentBlock,
  AgentMessage,
  AgentModel,
  ModelTurn,
  AgentTrigger,
} from "./types";
import type { Case, Joiner, ToolResult } from "@/lib/types";

interface MockModelContext {
  case: Case;
  joiner: Joiner;
  trigger: AgentTrigger;
}

function toolUse(name: string, input: Record<string, unknown> = {}): AgentContentBlock {
  return { type: "tool_use", id: `mock-tool-${randomUUID()}`, name, input };
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

function successfulProposal(messages: AgentMessage[], kind: "nudge" | "buddy_request"): boolean {
  return resultsFrom(messages).some(({ name, result }) => {
    if (name !== "propose_message" || result.status !== "ok") return false;
    return result.data && typeof result.data === "object" && "draft_id" in result.data
      ? kind === "nudge"
        ? !("request_id" in result.data && result.data.request_id)
        : Boolean("request_id" in result.data && result.data.request_id)
      : false;
  });
}

function hasSuccessful(messages: AgentMessage[], name: string): boolean {
  return resultsFrom(messages).some(({ name: resultName, result }) => resultName === name && result.status === "ok");
}

function equipmentData(result: ToolResult | undefined): { late: boolean; eta: string; owner_id: string; owner_name: string } | null {
  if (!result?.data || typeof result.data !== "object") return null;
  const data = result.data as Record<string, unknown>;
  if (typeof data.eta !== "string" || typeof data.owner_id !== "string") return null;
  return {
    late: data.late === true,
    eta: data.eta,
    owner_id: data.owner_id,
    owner_name: typeof data.owner_name === "string" ? data.owner_name : data.owner_id,
  };
}

function availabilityRecommendation(result: ToolResult | undefined): { candidate_id: string; candidate_name: string } | null {
  if (!result?.data || typeof result.data !== "object") return null;
  const recommendation = (result.data as Record<string, unknown>).recommendation;
  if (!recommendation || typeof recommendation !== "object") return null;
  const candidate_id = (recommendation as Record<string, unknown>).candidate_id;
  const candidate_name = (recommendation as Record<string, unknown>).candidate_name;
  return typeof candidate_id === "string" && typeof candidate_name === "string" ? { candidate_id, candidate_name } : null;
}

function declinedBuddyName(context: MockModelContext): string | null {
  const declined = [...context.case.buddy_requests].reverse().find((request) => request.status === "declined");
  if (!declined) return null;
  return buddyById(declined.candidate_id)?.full_name ?? declined.candidate_id;
}

function finishNextAction(
  context: MockModelContext,
  equipment: ReturnType<typeof equipmentData>,
  availability: ReturnType<typeof availabilityRecommendation>,
  hasSupersededBuddy: boolean,
  nudgeProposed: boolean,
  buddyProposed: boolean,
): string {
  if (!availability) return "People to arrange a buddy by hand; no eligible candidate in the current snapshot.";

  if (context.trigger === "buddy_declined" && buddyProposed) {
    const declined = declinedBuddyName(context);
    if (declined) return `Approve the replacement buddy request to ${availability.candidate_name}; ${declined} declined.`;
  }

  if (context.trigger === "start_date_changed" && hasSupersededBuddy && buddyProposed) {
    return `Start date moved to ${context.case.start_date}. Approve the re-proposed buddy request to ${availability.candidate_name}.`;
  }

  if (context.trigger === "availability_changed" && hasSupersededBuddy && buddyProposed) {
    return `Approve the refreshed buddy request to ${availability.candidate_name} after availability changed.`;
  }

  if (!equipment?.late && buddyProposed) {
    return `No equipment action needed. Approve the buddy request to ${availability.candidate_name}.`;
  }

  if (equipment?.late && nudgeProposed && buddyProposed) {
    return `Approve the equipment nudge to ${equipment.owner_name} and the buddy request to ${availability.candidate_name}.`;
  }

  if (equipment?.late && nudgeProposed) return `Approve the equipment nudge to ${equipment.owner_name}.`;
  if (buddyProposed) return `Approve the buddy request to ${availability.candidate_name}.`;
  return "Review the current case state.";
}

export function createMockModel(context: MockModelContext): AgentModel {
  let call = 0;
  return {
    provider: "mock",
    model: "deterministic-agent-model",
    async complete(messages: AgentMessage[]): Promise<ModelTurn> {
      call += 1;
      const seen = new Set(resultsFrom(messages).map((entry) => entry.name));
      if (!seen.has("get_case_state")) return { content: [toolUse("get_case_state")] };

      const buddyOnly = context.trigger === "buddy_declined" || context.trigger === "availability_changed";
      const hasActiveBuddy = context.case.buddy_requests.some((request) => ["pending_approval", "awaiting_acceptance", "accepted", "confirmed"].includes(request.status));
      const hasSupersededBuddy = context.case.buddy_requests.some((request) => ["declined", "superseded", "rejected"].includes(request.status));
      const shouldProposeBuddy = !hasActiveBuddy && (
        context.trigger === "contract.signed"
        || context.trigger === "buddy_declined"
        || context.trigger === "availability_changed"
        || (context.trigger === "start_date_changed" && hasSupersededBuddy)
      );

      if (!buddyOnly && !seen.has("check_equipment")) return { content: [toolUse("check_equipment")] };

      const equipment = equipmentData(latestResult(messages, "check_equipment"));
      if (!buddyOnly && equipment?.late && !seen.has("search_policy")) {
        return {
          content: [
            toolUse("search_policy", { query: "equipment order" }),
            toolUse("cite_policy", {
              page_id: "equipment-policy",
              quote: "IT orders equipment within five working days of the contract being signed.",
            }),
          ],
        };
      }
      if (!buddyOnly && equipment?.late && !successfulProposal(messages, "nudge")) {
        return {
          content: [toolUse("propose_message", {
            kind: "nudge",
            to: equipment.owner_id,
            subject: `Day-one laptop plan for ${context.joiner.preferred_name}`,
            body: `Hi ${equipment.owner_name}, ${context.joiner.preferred_name}'s ${context.joiner.equipment_preference.replaceAll("_", " ")} is due ${equipment.eta}, after the ${context.case.start_date} start. Can you arrange a loaner or earlier delivery so ${context.joiner.preferred_name} is equipped on day one?`,
            reason: "Equipment ETA is after the joiner's start date.",
            evidence: [equipment.eta, context.case.start_date, "equipment-policy"],
          })],
        };
      }
      if (!seen.has("get_buddy_availability")) return { content: [toolUse("get_buddy_availability")] };
      if (context.trigger === "contract.signed" && !seen.has("identity.grant_access")) {
        return { content: [toolUse("identity.grant_access", { joiner_id: context.joiner.id })] };
      }

      const availability = availabilityRecommendation(latestResult(messages, "get_buddy_availability"));
      if (shouldProposeBuddy && availability && !successfulProposal(messages, "buddy_request")) {
        return {
          content: [toolUse("propose_message", {
            kind: "buddy_request",
            to: availability.candidate_id,
            subject: `Buddy support request for ${context.joiner.preferred_name}`,
            body: `Please support ${context.joiner.preferred_name} as onboarding buddy during the first working week. Please accept or decline this specific request.`,
            reason: "Current policy and calendar facts provide an eligible buddy with two slots.",
            evidence: ["buddy_directory.get_availability", availability.candidate_id],
          })],
        };
      }
      if (shouldProposeBuddy && !availability && !hasSuccessful(messages, "escalate")) {
        return {
          content: [toolUse("escalate", {
            code: "NO_ELIGIBLE_BUDDY",
            summary: `No eligible buddy has two known first-week slots for ${context.joiner.preferred_name}.`,
            evidence: ["buddy_directory.get_availability"],
          })],
        };
      }
      if (!seen.has("finish")) {
        const nextAction = finishNextAction(
          context,
          equipment,
          availability,
          hasSupersededBuddy,
          successfulProposal(messages, "nudge"),
          successfulProposal(messages, "buddy_request"),
        );
        return { content: [toolUse("finish", { next_action: nextAction })] };
      }
      return { content: [{ type: "text", text: `Agent already finished on mock call ${call}.` }] };
    },
  };
}
