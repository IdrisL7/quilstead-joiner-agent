import type { AccessGrant, Role } from "@/lib/types";

// Role to system access matrix. Deterministic. The agent reads it, files a request per
// row through the identity connector, and never grants anything. `approver` is who the
// customer's own IdP approval flow routes the request to.

export const ACCESS_MATRIX: Record<Role, AccessGrant[]> = {
  software_engineer: [
    { system: "google_workspace", level: "standard", approver: "it" },
    { system: "slack", level: "standard", approver: "it" },
    { system: "okta", level: "standard", approver: "it" },
    { system: "github", level: "standard", approver: "manager" },
    { system: "humaans", level: "standard", approver: "it" },
  ],
  account_executive: [
    { system: "google_workspace", level: "standard", approver: "it" },
    { system: "slack", level: "standard", approver: "it" },
    { system: "okta", level: "standard", approver: "it" },
    { system: "salesforce", level: "standard", approver: "manager" },
    { system: "humaans", level: "standard", approver: "it" },
  ],
  customer_success_manager: [
    { system: "google_workspace", level: "standard", approver: "it" },
    { system: "slack", level: "standard", approver: "it" },
    { system: "okta", level: "standard", approver: "it" },
    { system: "salesforce", level: "standard", approver: "manager" },
    { system: "zendesk", level: "standard", approver: "manager" },
    { system: "humaans", level: "standard", approver: "it" },
  ],
  people_partner: [
    { system: "google_workspace", level: "standard", approver: "it" },
    { system: "slack", level: "standard", approver: "it" },
    { system: "okta", level: "standard", approver: "it" },
    { system: "humaans", level: "elevated", approver: "manager" },
  ],
  finance_analyst: [
    { system: "google_workspace", level: "standard", approver: "it" },
    { system: "slack", level: "standard", approver: "it" },
    { system: "okta", level: "standard", approver: "it" },
    { system: "netsuite", level: "elevated", approver: "finance" },
    { system: "humaans", level: "standard", approver: "it" },
  ],
};
