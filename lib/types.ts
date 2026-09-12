// Domain types for the Day-one readiness case.
//
// Design notes, stated once:
// - The agent cannot grant access. There is no tool for it; `identity.request_access`
//   creates a request that the customer's IdP approval flow owns.
// - The agent cannot complete a compliance item. `ComplianceItem.status` moves to
//   "evidenced" only through a human action recorded with `evidenced_by`.
// - Every outbound message is a `Draft` that sits in the approval queue until a human
//   approves it. Messaging actions accept a draft id and resolve the approved snapshot
//   from trusted application state, so caller-supplied status and recipients are ignored.

export type Country = "UK" | "US" | "DE";
export type EmploymentType = "employee" | "contractor";
export type WorkMode = "office" | "hybrid" | "remote";

export type Role =
  | "software_engineer"
  | "account_executive"
  | "customer_success_manager"
  | "people_partner"
  | "finance_analyst";

export type SystemName =
  | "google_workspace"
  | "slack"
  | "okta"
  | "github"
  | "salesforce"
  | "zendesk"
  | "humaans"
  | "netsuite";

export type AccessLevel = "standard" | "elevated";

export interface AccessGrant {
  system: SystemName;
  level: AccessLevel;
  approver: "manager" | "it" | "finance"; // who the customer's IdP flow routes the request to
}

export type RightToWorkStatus = "evidenced" | "pending" | "missing";

export interface Joiner {
  id: string;
  full_name: string;
  preferred_name: string;
  personal_email: string;
  role: Role;
  title: string;
  team: string;
  country: Country;
  entity: string; // legal entity the contract is with
  office: string;
  work_mode: WorkMode;
  employment_type: EmploymentType;
  start_date: string; // ISO date, local to the office
  manager_id: string;
  contract_signed_at: string; // ISO datetime
  right_to_work: {
    status: RightToWorkStatus;
    document?: string;
    evidenced_at?: string;
  };
  equipment_preference: "macbook_pro_14" | "macbook_air_13" | "thinkpad_x1";
  demo_note?: string; // the edge case this joiner exists to show, never shown to the model
}

export type PersonFunction = "manager" | "it" | "people" | "finance";

export interface Person {
  id: string;
  full_name: string;
  email: string;
  function: PersonFunction;
  office: string;
  country: Country;
  slack_handle: string;
  on_leave_until?: string; // ISO date; present only while on leave
  deputy_id?: string; // who covers while on leave
}

export interface BuddyCandidate {
  id: string;
  full_name: string;
  office: string;
  country: Country;
  timezone: string;
  team: string;
  tenure_months: number;
  active_buddies: number;
  on_leave: boolean;
  opted_in: boolean;
}

export type HrisEventType = "contract.signed" | "joiner.start_date_changed" | "joiner.withdrawn";

export interface HrisEvent {
  event_id: string; // idempotency key
  type: HrisEventType;
  occurred_at: string;
  joiner_id: string;
  payload: Record<string, unknown>;
}

export interface InboxMessage {
  id: string;
  from_joiner_id: string;
  received_at: string;
  subject: string;
  body: string;
}

// ---- Case model (Athena vocabulary: a case is the unit of work, steps are what happened) ----

export type CaseState =
  | "received"
  | "planned"
  | "in_progress"
  | "blocked"
  | "ready_for_day_one"
  | "closed"
  | "rejected"; // out of scope (contractor) or invalid

export type TaskType =
  | "hris_profile"
  | "right_to_work"
  | "i9_section_1"
  | "i9_section_2"
  | "tax_forms"
  | "works_council_notice"
  | "social_insurance_registration"
  | "access_request"
  | "equipment_order"
  | "esign_pack"
  | "slack_invite"
  | "buddy_allocation"
  | "manager_day_one_plan"
  | "welcome_message";

export type TaskStatus =
  | "open"
  | "waiting_approval"
  | "done"
  | "overdue"
  | "escalated"
  | "cancelled";

export type ComplianceCode = "UK_RTW" | "DE_RTW" | "US_I9_S1" | "US_I9_S2" | "DE_WORKS_COUNCIL" | "DE_SOCIAL_INSURANCE";

export interface Task {
  id: string;
  case_id: string;
  type: TaskType;
  title: string;
  owner_id: string; // Person.id
  owner_function: PersonFunction;
  due_at: string; // ISO datetime
  sla_hours: number;
  status: TaskStatus;
  compliance_code?: ComplianceCode; // present only for compliance-critical items
  system?: SystemName; // for access requests
  detail?: string;
  created_by: "agent" | "human";
  done_at?: string;
  done_by?: string; // human id for compliance items, "system" otherwise
}

export type EscalationCode =
  | "RTW_NOT_EVIDENCED"
  | "COMPLIANCE_DEADLINE_AT_RISK"
  | "MANAGER_UNAVAILABLE"
  | "OWNER_SLA_BREACHED"
  | "NO_ELIGIBLE_BUDDY"
  | "KB_NO_ANSWER"
  | "UNSAFE_ACTION_ATTEMPT"
  | "DUPLICATE_EVENT"
  | "OUT_OF_SCOPE"
  | "START_DATE_CHANGED";

export interface Escalation {
  id: string;
  case_id: string;
  code: EscalationCode;
  severity: "info" | "warn" | "critical";
  to_function: PersonFunction;
  to_person_id?: string;
  summary: string;
  evidence: string[]; // step ids or facts the human needs
  raised_at: string;
  resolved_at?: string;
  resolved_by?: string;
}

export type DraftKind = "nudge" | "welcome" | "joiner_answer" | "buddy_intro";
export type DraftAction = "slack.send_message" | "email.send" | "esign.send_pack";

export interface Draft {
  id: string;
  case_id: string;
  kind: DraftKind;
  action: DraftAction;
  channel: "slack" | "email";
  to: string; // person id or joiner id
  subject?: string;
  body: string;
  citations?: string[]; // policy KB page ids, required for joiner_answer
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_at?: string;
  decided_by?: string;
  decision_reason?: string;
}

export type StepActor = "system" | "agent" | "human";

export interface Step {
  id: string;
  case_id: string;
  at: string;
  actor: StepActor;
  kind: string; // e.g. "event.received", "plan.built", "task.created", "guard.refused"
  summary: string;
  data?: Record<string, unknown>;
}

export interface Case {
  id: string;
  joiner_id: string;
  event_id: string; // the event that opened it
  state: CaseState;
  opened_at: string;
  start_date: string;
  tasks: Task[];
  escalations: Escalation[];
  drafts: Draft[];
  steps: Step[];
  buddy_id?: string;
  closed_at?: string;
}

// ---- Task contract: what "done" means for one case, written before the agent acts ----

export interface TaskContract {
  case_id: string;
  goal: string;
  inputs: string[];
  constraints: string[];
  done_when: string[];
  escalate_when: string[];
}

// ---- Permission ladder ----

export type PermissionMode = "automatic" | "approval_required" | "prohibited";

export interface PermissionRule {
  tool: string; // "connector.action" or "connector.*"
  mode: PermissionMode;
  requires?: string[];
  note?: string;
}

// ---- Tool results: the observation shape every connector returns ----

export interface ToolResult<T = unknown> {
  status: "ok" | "warning" | "error" | "denied";
  summary: string;
  data?: T;
  next_actions?: string[];
  artifacts?: string[];
  retryable?: boolean;
}
