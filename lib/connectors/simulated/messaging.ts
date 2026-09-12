import type { Connector } from "../interface";
import { ok, denied } from "../interface";
import type { Draft } from "@/lib/types";

// Slack and email adapters accept only an approved Draft. There is no argument shape
// that sends free text. The approval is checked here as well as at the gate, so a bug in
// the gate cannot become a sent message.

export const sent: { channel: string; draft_id: string; to: string; at: string }[] = [];

function sendApproved(channel: "slack" | "email") {
  return async ({ draft, now }: Record<string, unknown>) => {
    const d = draft as Draft | undefined;
    if (!d || d.status !== "approved" || !d.decided_by) return denied(`${channel}.send refused: draft is not approved by a named person`);
    sent.push({ channel, draft_id: d.id, to: d.to, at: String(now) });
    return ok(`${channel} message ${d.id} sent to ${d.to} (approved by ${d.decided_by}).`, { draft_id: d.id });
  };
}

export const slack: Connector = {
  name: "slack",
  description: "Sends approved drafts to Slack.",
  simulated: true,
  production_target: "Slack Web API chat.postMessage via MCP; Athena's native channel.",
  actions: {
    send_message: { description: "Send an approved draft. Refuses anything else.", schema: { draft: "Draft (status=approved)", now: "iso datetime" }, run: sendApproved("slack") },
  },
};

export const email: Connector = {
  name: "email",
  description: "Sends approved drafts by email.",
  simulated: true,
  production_target: "Gmail API via MCP.",
  actions: {
    send: { description: "Send an approved draft. Refuses anything else.", schema: { draft: "Draft (status=approved)", now: "iso datetime" }, run: sendApproved("email") },
  },
};

export const esign: Connector = {
  name: "esign",
  description: "Sends the pre-start forms pack for signature once approved.",
  simulated: true,
  production_target: "DocuSign envelopes API.",
  actions: {
    send_pack: { description: "Send an approved pack. Refuses anything else.", schema: { draft: "Draft (status=approved)", now: "iso datetime" }, run: sendApproved("email") },
  },
};
