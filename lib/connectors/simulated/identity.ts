import type { Connector } from "../interface";
import { ok, failed } from "../interface";

// Simulated identity provider. Files access requests. There is deliberately no grant
// action on this connector; the customer's IdP approval flow owns approval.

export interface AccessRequest {
  id: string;
  joiner_id: string;
  system: string;
  level: string;
  approver: string;
  status: "requested";
  requested_at: string;
}

export const accessRequests: AccessRequest[] = [];

export const identity: Connector = {
  name: "identity",
  description: "Files access requests against the role matrix. Cannot grant.",
  simulated: true,
  production_target: "Okta access requests (or Google Workspace admin) via API or MCP; approvals stay in the IdP.",
  actions: {
    request_access: {
      description: "File an access request for one matrix row. Returns the request id.",
      schema: { joiner_id: "string", system: "string", level: "standard|elevated", approver: "it|manager|finance", now: "iso datetime" },
      run: async ({ joiner_id, system, level, approver, now }) => {
        if (!joiner_id || !system || !level || !approver) return failed("Missing matrix row fields");
        const id = `REQ-${String(accessRequests.length + 1).padStart(4, "0")}`;
        accessRequests.push({ id, joiner_id: String(joiner_id), system: String(system), level: String(level), approver: String(approver), status: "requested", requested_at: String(now) });
        return ok(`Access request ${id} filed for ${system} (${level}); approval with ${approver}.`, { request_id: id }, { next_actions: [`Await approval by ${approver} in the IdP`] });
      },
    },
  },
};
