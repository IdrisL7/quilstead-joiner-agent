import { createHash } from "node:crypto";
import type { Connector } from "../interface";
import { ok, denied } from "../interface";
import type { Draft, DraftAction } from "@/lib/types";
import { personById } from "@/data/people";

// Slack and email adapters accept only an approved Draft. There is no argument shape
// that sends free text. The approval is checked here as well as at the gate, so a bug in
// the gate cannot become a sent message.

export const sent: {
  action: DraftAction;
  channel: string;
  draft_id: string;
  to: string;
  at: string;
  content_version: string;
}[] = [];

interface StoredDraft extends Draft {
  content_version: string;
}

const drafts = new Map<string, StoredDraft>();

const contentVersion = (draft: Draft): string => createHash("sha256")
  .update(JSON.stringify({
    id: draft.id,
    case_id: draft.case_id,
    kind: draft.kind,
    action: draft.action,
    channel: draft.channel,
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
    citations: draft.citations ?? [],
  }))
  .digest("hex");

export const resetDraftState = (): void => {
  drafts.clear();
  sent.length = 0;
};

// These functions represent the trusted application path used by a human approval
// handler. Tool args never set approval state.
export const registerDraft = (draft: Draft): boolean => {
  if (drafts.has(draft.id)) return false;
  const snapshot: Draft = {
    ...draft,
    citations: draft.citations ? [...draft.citations] : undefined,
    status: "pending",
    decided_at: undefined,
    decided_by: undefined,
    decision_reason: undefined,
  };
  drafts.set(draft.id, { ...snapshot, content_version: contentVersion(snapshot) });
  return true;
};

export const approveDraft = (draftId: string, decidedBy: string, decidedAt: string): boolean => {
  const draft = drafts.get(draftId);
  if (!draft || draft.status !== "pending" || !personById(decidedBy)) return false;
  draft.status = "approved";
  draft.decided_by = decidedBy;
  draft.decided_at = decidedAt;
  return true;
};

export const rejectDraft = (draftId: string, decidedBy: string, decidedAt: string, reason: string): boolean => {
  const draft = drafts.get(draftId);
  if (!draft || draft.status !== "pending" || !personById(decidedBy)) return false;
  draft.status = "rejected";
  draft.decided_by = decidedBy;
  draft.decided_at = decidedAt;
  draft.decision_reason = reason;
  return true;
};

// A state change can make a pending draft unsafe to approve. It is a trusted
// application transition, not a human decision, so it cannot create an approval
// record and it leaves the old draft unavailable to every send action.
export const supersedeDraft = (draftId: string, decidedAt: string, reason: string): boolean => {
  const draft = drafts.get(draftId);
  if (!draft || draft.status !== "pending") return false;
  draft.status = "rejected";
  draft.decided_at = decidedAt;
  draft.decision_reason = reason;
  return true;
};

const approvedDraftFor = (
  action: DraftAction,
  channel: "slack" | "email",
  draftId: string,
): StoredDraft | undefined => {
  const draft = drafts.get(draftId);
  if (!draft || draft.status !== "approved" || !draft.decided_by || draft.channel !== channel) return undefined;
  if (draft.action !== action) return undefined;
  return contentVersion(draft) === draft.content_version ? draft : undefined;
};

function sendApproved(action: DraftAction, channel: "slack" | "email") {
  return async ({ draft_id, now }: Record<string, unknown>) => {
    if (typeof draft_id !== "string" || !draft_id) return denied(`${action} refused: draft_id is required`);
    const d = approvedDraftFor(action, channel, draft_id);
    if (!d) return denied(`${action} refused: no matching approved draft in trusted application state`);
    const previous = sent.find(
      (message) => message.action === action && message.channel === channel && message.draft_id === d.id,
    );
    if (previous) return ok(`${action} ${d.id} was already executed; duplicate suppressed.`, { draft_id: d.id, content_version: d.content_version });
    const noun = action === "esign.send_pack" ? "e-sign pack" : `${channel} message`;
    sent.push({ action, channel, draft_id: d.id, to: d.to, at: String(now), content_version: d.content_version });
    return ok(`${noun} ${d.id} sent to ${d.to} (approved by ${d.decided_by}).`, { draft_id: d.id, content_version: d.content_version });
  };
}

export const slack: Connector = {
  name: "slack",
  description: "Sends approved drafts to Slack.",
  simulated: true,
  production_target: "Slack Web API chat.postMessage via MCP; Athena's native channel.",
  actions: {
    send_message: { description: "Send a Slack draft by id after the trusted approval record is present.", schema: { draft_id: "string", now: "iso datetime" }, run: sendApproved("slack.send_message", "slack") },
  },
};

export const email: Connector = {
  name: "email",
  description: "Sends approved drafts by email.",
  simulated: true,
  production_target: "Gmail API via MCP.",
  actions: {
    send: { description: "Send an email draft by id after the trusted approval record is present.", schema: { draft_id: "string", now: "iso datetime" }, run: sendApproved("email.send", "email") },
  },
};

export const esign: Connector = {
  name: "esign",
  description: "Sends the pre-start forms pack for signature once approved.",
  simulated: true,
  production_target: "DocuSign envelopes API.",
  actions: {
    send_pack: { description: "Send an e-sign pack draft by id after the trusted approval record is present.", schema: { draft_id: "string", now: "iso datetime" }, run: sendApproved("esign.send_pack", "email") },
  },
};
