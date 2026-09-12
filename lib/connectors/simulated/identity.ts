import type { Connector } from "../interface";
import { ok, failed, denied } from "../interface";
import { currentJoinerById } from "@/lib/store/joiner-store";
import { accessRowsFor } from "@/lib/policy/access";
import type { AccessLevel, AccessGrant } from "@/lib/types";

// Simulated identity provider. Files access requests. There is deliberately no grant
// action on this connector; the customer's IdP approval flow owns approval.

export interface AccessRequest {
  id: string;
  joiner_id: string;
  system: AccessGrant["system"];
  level: AccessLevel;
  approver: AccessGrant["approver"];
  status: "requested";
  requested_at: string;
}

export const accessRequests: AccessRequest[] = [];

export const resetAccessRequests = (): void => {
  accessRequests.length = 0;
};

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
        if (!joiner_id || !system || !level || !approver || !now) return failed("Missing matrix row fields");
        const joiner = currentJoinerById(String(joiner_id));
        if (!joiner) return failed(`No joiner ${joiner_id}`);
        const matrixRow = accessRowsFor(joiner).find((row) => row.system === system && row.level === level);
        if (!matrixRow || matrixRow.approver !== approver) {
          return denied(`Access request refused: ${joiner.role} is not permitted to request ${String(level)} ${String(system)} with approver ${String(approver)}.`);
        }
        const existing = accessRequests.find(
          (request) => request.joiner_id === joiner.id && request.system === matrixRow.system && request.level === matrixRow.level,
        );
        if (existing) {
          return ok(`Access request ${existing.id} already filed for ${existing.system} (${existing.level}).`, { request_id: existing.id }, {
            next_actions: [`Await approval by ${existing.approver} in the IdP`],
          });
        }
        const id = `REQ-${String(accessRequests.length + 1).padStart(4, "0")}`;
        accessRequests.push({
          id,
          joiner_id: joiner.id,
          system: matrixRow.system,
          level: matrixRow.level,
          approver: matrixRow.approver,
          status: "requested",
          requested_at: String(now),
        });
        return ok(`Access request ${id} filed for ${matrixRow.system} (${matrixRow.level}); approval with ${matrixRow.approver}.`, { request_id: id }, {
          next_actions: [`Await approval by ${matrixRow.approver} in the IdP`],
        });
      },
    },
  },
};
