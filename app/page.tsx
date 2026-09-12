"use client";

import { useState } from "react";
import Image from "next/image";
import { DEMO_TRIGGER_PREVIEW } from "@/data/demo-trigger";

type ToolResult = { status: "ok" | "warning" | "error" | "denied"; summary: string };
type DemoDecision = "approve" | "reject";
type Section = "overview" | "equipment" | "buddy" | "activity";

interface DemoFacts {
  contract_event_id: string;
  contract_signed_at: string;
  equipment_task_due_at: string;
  equipment_task_title: string;
  equipment_owner_id: string;
  equipment_owner_name: string;
  start_date: string;
  equipment_eta: string;
  gap_days: number;
  equipment_late: boolean;
  policy_page_id: string;
  policy_quote: string;
  approval_required: string;
}

interface DemoDateChange {
  previous_start_date: string;
  new_start_date: string;
  risk_before: boolean;
  risk_after: boolean;
  deadlines_changed: number;
  tasks_changed: number;
  tasks_unchanged: number;
  tasks_added: number;
  superseded_draft_id?: string;
  superseded_buddy_request_id?: string;
}

interface DemoDraft {
  id: string;
  kind: string;
  action: string;
  channel: string;
  recipient: string;
  subject?: string;
  body: string;
  status: "pending" | "approved" | "rejected";
  decided_by?: string;
  decision_reason?: string;
}

interface BuddySlot {
  id: string;
  kind: "introduction" | "shadowing";
  start_at: string;
  end_at: string;
  timezone: string;
  duration_minutes: number;
}

interface BuddyCandidateAssessment {
  candidate: {
    id: string;
    full_name: string;
    office: string;
    timezone: string;
    team: string;
    tenure_months: number;
    active_buddies: number;
  };
  eligibility: { eligible: boolean; reasons: string[] };
  availability: {
    status: "available" | "busy" | "unavailable" | "unknown" | "error";
    reason: string;
    snapshot_at?: string;
    timezone?: string;
    slots: BuddySlot[];
  };
}

interface BuddyAvailability {
  start_date: string;
  candidates: BuddyCandidateAssessment[];
  recommendation: { candidate_id: string; candidate_name: string; reason: string; slots: BuddySlot[] } | null;
  escalation: { summary: string; evidence: string[] } | null;
}

interface BuddyRequest {
  id: string;
  draft_id: string;
  candidate_id: string;
  candidate_name: string;
  start_date: string;
  slots: BuddySlot[];
  status: "pending_approval" | "awaiting_acceptance" | "accepted" | "declined" | "rejected" | "superseded" | "confirmed";
  created_at: string;
  sent_at?: string;
  response?: "accepted" | "declined";
  responded_at?: string;
  confirmed_at?: string;
  confirmed_by?: string;
  confirmed_by_name?: string;
  invalidated_at?: string;
  invalidation_reason?: string;
}

interface BuddyState {
  availability: BuddyAvailability;
  request: BuddyRequest | null;
  draft: DemoDraft | null;
  before_approval: ToolResult | null;
  after_approval?: ToolResult;
}

interface AttentionSummary {
  equipment: { status: string; owner_name: string; next_action: string };
  buddy: { status: string; owner_name: string; next_action: string; candidate_name: string | null };
  compliance: { status: string; owner_name: string; next_action: string; open_tasks: number; total_tasks: number; unresolved_escalations: number };
}

interface DemoResponse {
  phase: "pending" | "resolved";
  screen_state: "awaiting_decision" | "draft_unavailable" | "no_action" | "resolved";
  run_id: string;
  decision?: DemoDecision;
  case: { id: string; state: string; start_date: string; task_count: number; buddy_id: string | null; buddy_task_status: string | null; buddy_task_done_by: string | null };
  joiner: { full_name: string; title: string; office: string; work_mode: string; start_date: string };
  model: { provider: "mock" | "anthropic"; model: string };
  equipment: { status: ToolResult["status"]; summary: string; eta: string | null };
  facts: DemoFacts;
  draft: DemoDraft | null;
  before_approval: ToolResult | null;
  after_approval?: ToolResult;
  attention: AttentionSummary;
  buddy: BuddyState;
  date_change?: DemoDateChange;
  draft_unavailable?: { message: string };
  trace: { actor: "system" | "agent" | "human"; kind: string; summary: string }[];
}

export interface ExecutionStep {
  key: "event" | "case" | "tasks" | "equipment" | "buddy" | "approval";
  label: string;
  status: "complete" | "attention";
  detail: string;
}

type ExecutionSummaryRun = Pick<DemoResponse, "case" | "facts" | "equipment" | "draft" | "buddy" | "trace">;

function traceEvidence(run: ExecutionSummaryRun, kind: string) {
  return run.trace.find((step) => step.kind === kind);
}

export function executionStepsFor(run: ExecutionSummaryRun): ExecutionStep[] {
  const eventEvidence = traceEvidence(run, "event.received");
  const contractEvidence = traceEvidence(run, "contract.written");
  const planEvidence = traceEvidence(run, "plan.built");
  const equipmentEvidence = traceEvidence(run, "tool.equipment.order");
  const buddyEvidence = traceEvidence(run, "tool.buddy_directory.get_availability");

  return [
    {
      key: "event",
      label: "Event received",
      status: eventEvidence ? "complete" : "attention",
      detail: eventEvidence?.summary ?? "The returned trace did not include the contract-signed event.",
    },
    {
      key: "case",
      label: "Case created",
      status: contractEvidence && !!run.case.id ? "complete" : "attention",
      detail: contractEvidence ? `${run.case.id} opened for ${run.facts.contract_event_id}.` : "The returned trace did not confirm the case opening.",
    },
    {
      key: "tasks",
      label: "Tasks planned",
      status: planEvidence ? "complete" : "attention",
      detail: planEvidence?.summary ?? `${run.case.task_count} tasks were returned without a planning evidence step.`,
    },
    {
      key: "equipment",
      label: "Equipment checked",
      status: equipmentEvidence ? (run.equipment.status === "warning" ? "attention" : "complete") : "attention",
      detail: equipmentEvidence?.summary ?? "The returned trace did not include an equipment check.",
    },
    {
      key: "buddy",
      label: "Buddy availability checked",
      status: buddyEvidence ? "complete" : "attention",
      detail: buddyEvidence?.summary ?? "The returned trace did not include a buddy availability check.",
    },
    {
      key: "approval",
      label: "Equipment approval required",
      status: run.draft ? "attention" : "complete",
      detail: run.draft
        ? `Draft ${run.draft.id} is pending approval. Nothing was sent.`
        : "No equipment action is required from the current facts.",
    },
  ];
}

/* ---------- formatting ---------- */

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
    .format(new Date(value));
}

function formatSlot(slot: BuddySlot) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: slot.timezone,
  });
  return `${formatter.format(new Date(slot.start_at))} to ${new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: slot.timezone,
  }).format(new Date(slot.end_at))}`;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function availabilityLabel(status: BuddyCandidateAssessment["availability"]["status"]) {
  if (status === "available") return "Available";
  if (status === "busy") return "No suitable slots";
  if (status === "unknown") return "Availability unknown";
  if (status === "error") return "Calendar read failed";
  return "Unavailable";
}

function requestLabel(status: BuddyRequest["status"]) {
  if (status === "pending_approval") return "Awaiting approval";
  if (status === "awaiting_acceptance") return "Awaiting buddy acceptance";
  if (status === "accepted") return "Awaiting People confirmation";
  if (status === "declined") return "Buddy declined";
  if (status === "rejected") return "Request rejected";
  if (status === "superseded") return "Request superseded";
  return "Allocation confirmed";
}

function requestTone(status: BuddyRequest["status"]) {
  if (status === "confirmed") return "positive";
  if (status === "awaiting_acceptance" || status === "accepted") return "pending";
  if (status === "pending_approval") return "info";
  return "attention";
}

function activeBuddyRequest(request: Pick<BuddyRequest, "status"> | null) {
  return !!request && ["pending_approval", "awaiting_acceptance", "accepted", "confirmed"].includes(request.status);
}

export function simulationTargetFor(
  request: Pick<BuddyRequest, "status" | "candidate_id"> | null,
  recommendation: Pick<NonNullable<BuddyAvailability["recommendation"]>, "candidate_id"> | null,
) {
  return activeBuddyRequest(request) ? request?.candidate_id ?? null : recommendation?.candidate_id ?? null;
}

function attentionTone(status: string) {
  if (["On track", "Confirmed", "Complete"].includes(status)) return "positive";
  if (["Awaiting IT response", "Awaiting buddy acceptance", "Awaiting People confirmation", "In progress", "Ready for review"].includes(status)) return "pending";
  return "attention";
}

function modelLabel(provider: DemoResponse["model"]["provider"]) {
  return provider === "anthropic" ? "Anthropic model" : "Mock model";
}

function gapLabel(gapDays: number) {
  if (gapDays === 0) return "Same day as first day";
  const days = Math.abs(gapDays);
  return `${days} calendar ${days === 1 ? "day" : "days"} ${gapDays > 0 ? "after" : "before"} first day`;
}

function decisionLabel(run: DemoResponse) {
  if (run.screen_state === "awaiting_decision") return "Awaiting decision";
  if (run.screen_state === "draft_unavailable") return "Draft unavailable";
  if (run.screen_state === "no_action") return "Risk cleared";
  return run.decision === "approve" ? "Sent with approval" : "Rejected";
}

function decisionTone(run: DemoResponse) {
  if (run.screen_state === "awaiting_decision") return "pending";
  if (run.screen_state === "draft_unavailable") return "attention";
  if (run.screen_state === "no_action" || run.decision === "approve") return "positive";
  return "attention";
}

const IMPORTANT_TRACE = /(decision|approved|rejected|sent|refused|escalat|superseded|recomputed|confirmed|accepted|declined|received)/i;

/* ---------- small presentational pieces ---------- */

type ApprovalPanelRun = {
  screen_state: DemoResponse["screen_state"];
  facts: Pick<DemoFacts, "equipment_late" | "start_date" | "equipment_eta">;
};

export function ApprovalEmptyState({ run }: { run: ApprovalPanelRun }) {
  if (run.screen_state === "draft_unavailable") {
    return (
      <div className="no-action-heading unavailable-heading">
        <p className="eyebrow">Model-proposed action</p>
        <h2>Draft unavailable. Equipment risk remains</h2>
        <p>The current ETA is still after the current start date. Retry drafting before any message can be sent.</p>
      </div>
    );
  }

  if (run.screen_state === "no_action" && !run.facts.equipment_late) {
    return (
      <div className="no-action-heading">
        <p className="eyebrow">Model-proposed action</p>
        <h2>No message needed</h2>
        <p>The current ETA precedes the current start date, so the superseded draft is not available to send.</p>
      </div>
    );
  }

  return null;
}

export function WorkflowTriggerCard({ busy, onTrigger }: { busy: boolean; onTrigger: () => void }) {
  return (
    <section className="panel trigger-card" aria-label="Workflow trigger">
      <div className="panel-head">
        <div className="trigger-heading">
          <p className="eyebrow">Workflow trigger</p>
          <h2>Contract signed</h2>
        </div>
        <Tag tone="info">{DEMO_TRIGGER_PREVIEW.source}</Tag>
      </div>
      <div className="panel-body trigger-body">
        <div className="trigger-grid">
          <div>
            <span className="fact-label">Event</span>
            <strong>{DEMO_TRIGGER_PREVIEW.event_type}</strong>
          </div>
          <div>
            <span className="fact-label">Joiner</span>
            <strong>{DEMO_TRIGGER_PREVIEW.joiner.full_name}</strong>
            <span className="fact-detail">{DEMO_TRIGGER_PREVIEW.joiner.title} · {DEMO_TRIGGER_PREVIEW.joiner.office} · starts {formatDate(DEMO_TRIGGER_PREVIEW.joiner.start_date)}</span>
          </div>
        </div>
        <details className="disclosure">
          <summary><span>Event details</span><span className="meta">fixture evidence</span></summary>
          <div className="disclosure-body small">
            <div className="facts">
              <div><span>Event ID</span><strong>{DEMO_TRIGGER_PREVIEW.event_id}</strong></div>
              <div><span>Fixture timestamp</span><strong>{formatDateTime(DEMO_TRIGGER_PREVIEW.occurred_at)}</strong></div>
              <div><span>Start date</span><strong>{formatDate(DEMO_TRIGGER_PREVIEW.joiner.start_date)}</strong></div>
              <div><span>Work mode</span><strong>{DEMO_TRIGGER_PREVIEW.joiner.work_mode}</strong></div>
            </div>
          </div>
        </details>
        <div className="trigger-action">
          <p>Runs the existing onboarding flow against the simulated HRIS event. No external event is sent.</p>
          <button className="button primary" type="button" onClick={onTrigger} disabled={busy}>{busy ? "Processing event..." : "Simulate contract signed"}</button>
        </div>
      </div>
    </section>
  );
}

function ExecutionSummary({ run }: { run: ExecutionSummaryRun }) {
  const steps = executionStepsFor(run);
  return (
    <section className="panel execution-summary" aria-label="Initial trigger run">
      <div className="panel-head">
        <div className="trigger-heading">
          <p className="eyebrow">Initial trigger run</p>
          <h3>Onboarding flow completed</h3>
        </div>
        <Tag tone="positive">Evidence returned</Tag>
      </div>
      <div className="execution-list">
        {steps.map((step) => (
          <div className={`execution-step ${step.status}`} key={step.key}>
            <span className="execution-icon" aria-hidden="true">{step.status === "complete" ? "✓" : "!"}</span>
            <div>
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="execution-foot">This is the initial trigger result. Current attention below reflects the live case state after the run.</div>
    </section>
  );
}

function Tag({ tone, children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`tag ${tone ?? ""}`}>{children}</span>;
}

const NAV: { key: Section; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Overview", icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8.5 8 3l6 5.5M4 7.5V13h8V7.5" /></svg> },
  { key: "equipment", label: "Equipment", icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3.5" width="12" height="8" rx="1" /><path d="M1.5 13h13" /></svg> },
  { key: "buddy", label: "Buddy support", icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="2.5" /><circle cx="11.5" cy="7" r="2" /><path d="M1.5 13.5c.6-2.3 2.3-3.5 4.5-3.5s3.9 1.2 4.5 3.5M10.5 10.6c1.9 0 3.3.9 4 2.9" /></svg> },
  { key: "activity", label: "Activity", icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8h3l2-4 3 8 2-4h2" /></svg> },
];

/* ---------- data access ---------- */

async function postDemo(body: Record<string, string> = {}) {
  const response = await fetch("/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as DemoResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The demo flow failed");
  return payload;
}

/* ---------- page ---------- */

export default function Home() {
  const [run, setRun] = useState<DemoResponse | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [dateDraft, setDateDraft] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "date" | "retry" | "availability" | "buddy_prepare" | "buddy_approve" | "buddy_reject" | "buddy_accept" | "buddy_decline" | "buddy_confirm" | DemoDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  function acceptRun(next: DemoResponse) {
    setRun(next);
    setDateDraft(next.joiner.start_date);
    setSelectedCandidateId(activeBuddyRequest(next.buddy.request)
      ? next.buddy.request?.candidate_id ?? null
      : next.buddy.availability.recommendation?.candidate_id ?? null);
  }

  async function startFlow() {
    setBusy("start");
    setError(null);
    try {
      const next = await postDemo();
      acceptRun(next);
      setSection("overview");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The demo flow failed");
    } finally {
      setBusy(null);
    }
  }

  async function decide(decision: DemoDecision) {
    if (!run || !run.draft || run.screen_state !== "awaiting_decision") return;
    setBusy(decision);
    setError(null);
    try {
      acceptRun(await postDemo({ run_id: run.run_id, decision }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The approval action failed");
    } finally {
      setBusy(null);
    }
  }

  async function changeStartDate() {
    if (!run || !dateDraft || run.phase !== "pending" || dateDraft === run.joiner.start_date) return;
    setBusy("date");
    setError(null);
    try {
      acceptRun(await postDemo({ run_id: run.run_id, action: "start_date_change", start_date: dateDraft }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The start-date change failed");
    } finally {
      setBusy(null);
    }
  }

  async function retryDraft() {
    if (!run || run.screen_state !== "draft_unavailable") return;
    setBusy("retry");
    setError(null);
    try {
      acceptRun(await postDemo({ run_id: run.run_id, action: "retry_draft" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The draft retry failed");
    } finally {
      setBusy(null);
    }
  }

  async function prepareBuddy(candidateId: string) {
    if (!run) return;
    setSelectedCandidateId(candidateId);
    setBusy("buddy_prepare");
    setError(null);
    try {
      acceptRun(await postDemo({ run_id: run.run_id, action: "buddy_prepare", candidate_id: candidateId }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The buddy request could not be prepared");
    } finally {
      setBusy(null);
    }
  }

  async function simulateAvailability(candidateId: string) {
    if (!run) return;
    setBusy("availability");
    setError(null);
    try {
      acceptRun(await postDemo({ run_id: run.run_id, action: "buddy_availability_change", candidate_id: candidateId }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The simulated availability change failed");
    } finally {
      setBusy(null);
    }
  }

  async function decideBuddy(decision: DemoDecision) {
    if (!run || !run.buddy.request || !run.buddy.draft || run.buddy.request.status !== "pending_approval") return;
    setBusy(decision === "approve" ? "buddy_approve" : "buddy_reject");
    setError(null);
    try {
      acceptRun(await postDemo({
        run_id: run.run_id,
        action: "buddy_decision",
        request_id: run.buddy.request.id,
        draft_id: run.buddy.draft.id,
        decision,
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The buddy approval action failed");
    } finally {
      setBusy(null);
    }
  }

  async function simulateBuddyResponse(response: "accepted" | "declined") {
    if (!run || !run.buddy.request || run.buddy.request.status !== "awaiting_acceptance") return;
    setBusy(response === "accepted" ? "buddy_accept" : "buddy_decline");
    setError(null);
    try {
      acceptRun(await postDemo({ run_id: run.run_id, action: "buddy_response", request_id: run.buddy.request.id, response }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The simulated buddy response failed");
    } finally {
      setBusy(null);
    }
  }

  async function confirmBuddyAllocation() {
    if (!run || !run.buddy.request || run.buddy.request.status !== "accepted") return;
    setBusy("buddy_confirm");
    setError(null);
    try {
      acceptRun(await postDemo({ run_id: run.run_id, action: "buddy_confirm", request_id: run.buddy.request.id }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The buddy confirmation failed");
    } finally {
      setBusy(null);
    }
  }

  /* ---------- derived ---------- */

  const isPending = run?.screen_state === "awaiting_decision" && !!run.draft;
  const wasApproved = run?.decision === "approve";
  const buddyRequest = run?.buddy.request ?? null;
  const hasActiveBuddy = activeBuddyRequest(buddyRequest);
  const recommendedBuddy = run?.buddy.availability.recommendation;
  const simulationTarget = simulationTargetFor(buddyRequest, recommendedBuddy ?? null);
  const buddyCandidates = run ? (() => {
    const top = run.buddy.availability.candidates.slice(0, 3);
    const currentRequestCandidate = buddyRequest && ["pending_approval", "awaiting_acceptance", "accepted", "confirmed"].includes(buddyRequest.status)
      ? buddyRequest.candidate_id
      : undefined;
    const requiredId = currentRequestCandidate ?? recommendedBuddy?.candidate_id;
    if (!requiredId || top.some((assessment) => assessment.candidate.id === requiredId)) return top;
    const required = run.buddy.availability.candidates.find((assessment) => assessment.candidate.id === requiredId);
    return required ? [...top.slice(0, 2), required] : top;
  })() : [];
  const simulationCandidate = run?.buddy.availability.candidates.find((assessment) => assessment.candidate.id === simulationTarget && assessment.availability.status === "available");
  const selectedAssessment = run?.buddy.availability.candidates.find((assessment) => assessment.candidate.id === selectedCandidateId) ?? null;
  const timelineItems = run ? [
    { key: "contract", at: run.facts.contract_signed_at, date: formatDateTime(run.facts.contract_signed_at), title: "Contract signed", detail: `${run.facts.contract_event_id} received`, tone: "" },
    { key: "equipment-task", at: run.facts.equipment_task_due_at, date: `Due ${formatDateTime(run.facts.equipment_task_due_at)}`, title: run.facts.equipment_task_title, detail: `Owner: ${run.facts.equipment_owner_name}`, tone: "" },
    { key: "start", at: `${run.facts.start_date}T00:00:00Z`, date: formatDate(run.facts.start_date), title: "First day", detail: `${run.joiner.office} / ${run.joiner.work_mode}`, tone: "" },
    { key: "delivery", at: `${run.facts.equipment_eta}T00:00:00Z`, date: `ETA ${formatDate(run.facts.equipment_eta)}`, title: "Equipment delivery", detail: `${gapLabel(run.facts.gap_days)} / ${run.facts.equipment_owner_name}`, tone: run.facts.equipment_late ? "risk" : "cleared" },
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at)) : [];
  const openAttention = run ? [run.attention.equipment, run.attention.buddy, run.attention.compliance].filter((item) => attentionTone(item.status) !== "positive").length : 0;

  /* ---------- pieces that need state ---------- */

  const navButtons = (variant: "side" | "tab") =>
    NAV.map((item) => (
      <button
        key={item.key}
        type="button"
        className={variant === "side" ? "nav-button" : "tab"}
        aria-current={section === item.key ? "page" : undefined}
        onClick={() => setSection(item.key)}
      >
        {variant === "side" && item.icon}
        {item.label}
        {variant === "side" && item.key === "overview" && openAttention > 0 && <span className="nav-count" aria-label={`${openAttention} items need attention`}>{openAttention}</span>}
      </button>
    ));

  const dateChangeNote = run?.date_change && (
    <div className="change-note" role="status">
      <strong>Start date moved {formatDate(run.date_change.previous_start_date)} to {formatDate(run.date_change.new_start_date)}</strong>
      <span>{run.date_change.risk_before && !run.date_change.risk_after ? "Late-arrival risk cleared from the current dates. The pending draft was superseded." : run.date_change.risk_after ? "Late-arrival risk remains from the current dates. A fresh draft is available for review." : "The current case was recalculated from the new start date."}</span>
      <div className="change-stats"><span>{run.date_change.deadlines_changed} deadlines moved</span><span>{run.date_change.tasks_changed} tasks reconciled</span><span>{run.date_change.tasks_unchanged} unchanged</span>{run.date_change.superseded_buddy_request_id && <span>buddy request superseded</span>}</div>
    </div>
  );

  const riskCard = run && (
    <div className={`risk ${run.facts.equipment_late ? "" : "cleared"}`}>
      <div className="risk-icon" aria-hidden="true">{run.facts.equipment_late ? "!" : "✓"}</div>
      <div>
        <strong>{run.facts.equipment_late ? "Laptop misses day one" : "Laptop is on track for day one"}</strong>
        <p>{run.facts.equipment_late ? run.equipment.summary : `The ${formatDate(run.facts.equipment_eta)} ETA now precedes the ${formatDate(run.facts.start_date)} start.`}</p>
      </div>
    </div>
  );

  /* ---------- sections ---------- */

  function renderOverview(current: DemoResponse) {
    const rows = [
      { key: "equipment" as Section, label: "Equipment", data: current.attention.equipment, detail: current.facts.equipment_late ? `ETA ${formatDate(current.facts.equipment_eta)}, start ${formatDate(current.facts.start_date)}` : `ETA ${formatDate(current.facts.equipment_eta)} before start` },
      { key: "buddy" as Section, label: "Buddy support", data: current.attention.buddy, detail: current.attention.buddy.candidate_name ?? "No candidate selected" },
    ];
    const compliance = current.attention.compliance;
    return (
      <>
        <ExecutionSummary run={current} />
        <div className="section-title"><h2>Overview</h2><p>Current case state. Rows open their work area.</p></div>
        <section className="panel" aria-label="Attention">
          <div className="panel-head"><h3>Needs attention</h3><span className="meta">{openAttention === 0 ? "Nothing open" : `${openAttention} open`}</span></div>
          <div className="rows">
            {rows.map((row) => (
              <div className="row clickable" key={row.key} role="button" tabIndex={0} onClick={() => setSection(row.key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSection(row.key); } }}>
                <div className="row-label"><strong>{row.label}</strong><Tag tone={attentionTone(row.data.status)}>{row.data.status}</Tag></div>
                <div className="row-main"><strong>{row.detail}</strong><span>Owner {row.data.owner_name}</span><span className="next">Next: {row.data.next_action}</span></div>
                <div className="row-side"><span className="button ghost small">Open</span></div>
              </div>
            ))}
            <div className="row">
              <div className="row-label"><strong>Compliance</strong><Tag tone={attentionTone(compliance.status)}>{compliance.status}</Tag></div>
              <div className="row-main">
                <strong>{compliance.open_tasks} of {compliance.total_tasks} compliance task{compliance.total_tasks === 1 ? "" : "s"} open</strong>
                <span>Owner {compliance.owner_name}</span>
                <span className="next">Next: {compliance.next_action}</span>
              </div>
              <div className="row-side">
                <details className="disclosure">
                  <summary>Evidence</summary>
                  <div className="disclosure-body small">
                    <div className="facts">
                      <div><span>Open tasks</span><strong>{compliance.open_tasks} of {compliance.total_tasks}</strong></div>
                      <div><span>Unresolved escalations</span><strong>{compliance.unresolved_escalations}</strong></div>
                      <div><span>Start date</span><strong>{formatDate(current.facts.start_date)}</strong></div>
                      <div><span>Owner</span><strong>{compliance.owner_name}</strong></div>
                    </div>
                    <p className="muted">Compliance items are evidenced by a named person. The agent tracks and escalates; it cannot complete them.</p>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </section>
        {dateChangeNote}
        <section className="panel" aria-label="Case timeline">
          <div className="panel-head"><h3>Timeline</h3><span className="meta">source facts, chronological</span></div>
          <div className="panel-body">
            <ol className="timeline">
              {timelineItems.map((item) => (
                <li className={`timeline-item ${item.tone}`} key={item.key}>
                  <span className="timeline-dot" aria-hidden="true" />
                  <span className="timeline-date">{item.date}</span>
                  <div className="timeline-body"><strong>{item.title}</strong><span>{item.detail}</span></div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </>
    );
  }

  function renderEquipment(current: DemoResponse) {
    return (
      <>
        <div className="section-title"><h2>Equipment</h2><p>Case facts on the left, the exact proposed action on the right.</p></div>
        <div className="two-col">
          <div className="stack">
            <section className="panel" aria-label="Equipment facts">
              <div className="panel-head"><h3>Current facts</h3><Tag tone={attentionTone(current.attention.equipment.status)}>{current.attention.equipment.status}</Tag></div>
              <div className="panel-body stack">
                {riskCard}
                <div className="facts">
                  <div><span>Start date</span><strong>{formatDate(current.facts.start_date)}</strong></div>
                  <div><span>Equipment ETA</span><strong>{formatDate(current.facts.equipment_eta)}</strong></div>
                  <div><span>Relation</span><strong>{gapLabel(current.facts.gap_days)}</strong></div>
                  <div><span>Task deadline</span><strong>{formatDateTime(current.facts.equipment_task_due_at)}</strong></div>
                  <div><span>Owner</span><strong>{current.facts.equipment_owner_name}</strong></div>
                  <div><span>Task</span><strong>{current.facts.equipment_task_title}</strong></div>
                </div>
                <div className="next-action"><strong>Next:</strong> {current.attention.equipment.next_action}</div>
                {dateChangeNote}
              </div>
            </section>
          </div>

          <section className="panel" aria-label="Approval">
            <div className="panel-head"><h3>Proposed action</h3><Tag tone={decisionTone(current)}>{decisionLabel(current)}</Tag></div>
            <div className="panel-body stack">
              {current.draft ? (
                <>
                  <div className="draft-meta">
                    <div><span>To</span><strong>{current.draft.recipient}</strong></div>
                    <div><span>Channel</span><strong>{current.draft.channel}</strong></div>
                    <div><span>Subject</span><strong>{current.draft.subject}</strong></div>
                    <div><span>Wording</span><Tag tone="violet">{modelLabel(current.model.provider)}</Tag></div>
                  </div>
                  <div className="message">
                    <div className="message-avatar" aria-hidden="true">A</div>
                    <div>
                      <div className="message-head"><strong>Athena</strong><span>to {current.draft.recipient}</span></div>
                      <p>{current.draft.body}</p>
                    </div>
                  </div>
                </>
              ) : <ApprovalEmptyState run={current} />}

              <details className="disclosure">
                <summary><span>Why this action</span><span className="meta">facts and policy source</span></summary>
                <div className="disclosure-body">
                  <p className="muted small">The recommendation is grounded in the current case snapshot. Generated wording is kept separate from source facts.</p>
                  <div className="facts">
                    <div><span>Start date</span><strong>{formatDate(current.facts.start_date)}</strong></div>
                    <div><span>Equipment ETA</span><strong>{formatDate(current.facts.equipment_eta)}</strong></div>
                    <div><span>Task deadline</span><strong>{formatDateTime(current.facts.equipment_task_due_at)}</strong></div>
                    <div><span>Owner</span><strong>{current.facts.equipment_owner_name}</strong></div>
                  </div>
                  <div><p className="muted small">Source policy: {current.facts.policy_page_id}</p><blockquote className="quote">{current.facts.policy_quote}</blockquote></div>
                  <div className="gate"><strong>Human gate</strong>{current.facts.approval_required}</div>
                </div>
              </details>

              {isPending ? (
                <div className="actions">
                  <p>Draft awaiting your approval. Nothing is sent until you approve.</p>
                  <div className="action-buttons">
                    <button className="button secondary" onClick={() => decide("reject")} disabled={busy !== null}>Reject draft</button>
                    <button className="button primary" onClick={() => decide("approve")} disabled={busy !== null}>{busy === "approve" ? "Sending..." : "Approve and send"}</button>
                  </div>
                </div>
              ) : current.screen_state === "draft_unavailable" ? (
                <div className="outcome unavailable" role="alert">
                  <span className="outcome-icon">!</span>
                  <div><strong>Draft unavailable.</strong><p>{current.draft_unavailable?.message}</p><div style={{ marginTop: 8 }}><button className="button secondary small" onClick={retryDraft} disabled={busy !== null}>{busy === "retry" ? "Retrying..." : "Retry draft"}</button></div></div>
                </div>
              ) : current.screen_state === "no_action" ? (
                <div className="outcome positive" role="status">
                  <span className="outcome-icon">✓</span>
                  <div><strong>Risk cleared from current dates.</strong><p>No outbound action was sent. Change the start date to recalculate the same case.</p></div>
                </div>
              ) : (
                <div className={`outcome ${wasApproved ? "positive" : "negative"}`} role="status">
                  <span className="outcome-icon">{wasApproved ? "✓" : "×"}</span>
                  <div><strong>{wasApproved ? "Sent with approval. Awaiting IT response." : "Nothing was sent."}</strong><p>{current.after_approval?.summary}</p>{current.draft?.decided_by && <p>Decided by {current.draft.decided_by}{current.draft.decision_reason ? `: ${current.draft.decision_reason}` : ""}</p>}</div>
                </div>
              )}
            </div>
          </section>
        </div>
      </>
    );
  }

  function renderBuddy(current: DemoResponse) {
    const request = buddyRequest;
    const detail = selectedAssessment;
    const canPrepare = !!detail && !hasActiveBuddy && busy === null && detail.eligibility.eligible && detail.availability.status === "available";
    const stepState = (n: 1 | 2 | 3): "todo" | "active" | "done" => {
      if (!request) return n === 1 ? "active" : "todo";
      const s = request.status;
      const sent = !!request.sent_at;
      const responded = !!request.response;
      if (n === 1) return sent ? "done" : "active";
      if (n === 2) return responded ? "done" : sent && s === "awaiting_acceptance" ? "active" : "todo";
      return request.confirmed_at ? "done" : responded && s === "accepted" ? "active" : "todo";
    };
    return (
      <>
        <div className="section-title"><h2>Buddy support</h2><p>Compare candidates on the left. The request on the right is not sent until People approves the exact preview.</p></div>
        <div className="two-col">
          <div className="stack">
            <section className="panel" aria-label="Candidate comparison">
              <div className="panel-head"><h3>Candidates</h3><span className="meta">top {buddyCandidates.length} of {current.buddy.availability.candidates.length} · <span className="sim-badge">Simulated calendar</span></span></div>
              <div>
                {buddyCandidates.map((assessment) => {
                  const { candidate, eligibility, availability } = assessment;
                  const isRequested = request?.candidate_id === candidate.id;
                  const isRecommended = recommendedBuddy?.candidate_id === candidate.id;
                  return (
                    <button type="button" className="cand" key={candidate.id} aria-pressed={selectedCandidateId === candidate.id} onClick={() => setSelectedCandidateId(candidate.id)}>
                      <span className="avatar small" aria-hidden="true">{initials(candidate.full_name)}</span>
                      <span className="cand-name"><strong>{candidate.full_name}</strong><span>{candidate.team} · {candidate.office}</span></span>
                      <span className="cand-col"><span>Capacity</span><strong>{candidate.active_buddies} of 2 · {candidate.tenure_months} mo tenure</strong></span>
                      <span className="cand-col"><span>Availability</span><strong className={`availability ${availability.status}`}>{availabilityLabel(availability.status)}{availability.slots.length > 0 ? ` · ${availability.slots.length} slots` : ""}</strong></span>
                      <span className="cand-tags">
                        <Tag tone={eligibility.eligible ? "positive" : "attention"}>{eligibility.eligible ? "Eligible" : "Not eligible"}</Tag>
                        {isRequested ? <Tag tone="info">Current request</Tag> : isRecommended ? <Tag tone="violet">Recommended</Tag> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
            {current.buddy.availability.escalation && !current.buddy.availability.recommendation && (
              <div className="escalation" role="status"><strong>People review required</strong>{current.buddy.availability.escalation.summary}</div>
            )}
            {simulationCandidate && (
              <div className="panel">
                <div className="panel-head"><h3>Demo simulation</h3><span className="sim-badge">Simulated calendar</span></div>
                <div className="panel-body actions">
                  <p>Change {simulationCandidate.candidate.full_name}&apos;s calendar and watch the evidence, status and next action update together.</p>
                  <button className="button secondary small" onClick={() => simulateAvailability(simulationCandidate.candidate.id)} disabled={busy !== null}>{busy === "availability" ? "Refreshing calendar..." : `Simulate ${simulationCandidate.candidate.full_name} unavailable`}</button>
                </div>
              </div>
            )}
          </div>

          <div className="stack">
            <section className="panel" aria-label="Selected candidate">
              <div className="panel-head"><h3>{detail ? detail.candidate.full_name : "Select a candidate"}</h3>{detail && <Tag tone={detail.eligibility.eligible ? "positive" : "attention"}>{detail.eligibility.eligible ? "Eligible" : "Not eligible"}</Tag>}</div>
              <div className="panel-body stack">
                {!detail && <p className="muted small">Choose a row to see eligibility, capacity, availability and proposed London-time slots. Selecting never sends anything.</p>}
                {detail && (
                  <>
                    <div className="facts">
                      <div><span>Team · office</span><strong>{detail.candidate.team} · {detail.candidate.office}</strong></div>
                      <div><span>Capacity</span><strong>{detail.candidate.active_buddies} of 2 active</strong></div>
                      <div><span>Tenure</span><strong>{detail.candidate.tenure_months} months</strong></div>
                      <div><span>Availability</span><strong className={`availability ${detail.availability.status}`}>{availabilityLabel(detail.availability.status)}</strong></div>
                    </div>
                    <p className="muted small">{detail.availability.reason}</p>
                    {detail.eligibility.reasons.length > 0 && <ul className="reasons">{detail.eligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                    {detail.availability.slots.length > 0 && (
                      <div className="slots">
                        {detail.availability.slots.map((slot) => <div className="slot" key={slot.id}><span className="kind">{slot.kind}</span><span className="when">{formatSlot(slot)}</span><span className="tz">{slot.duration_minutes} min · {slot.timezone}</span></div>)}
                      </div>
                    )}
                    {!hasActiveBuddy && (
                      <div className="actions">
                        <p>{canPrepare ? "Prepares an exact request preview. No message is sent yet." : "Only an eligible, available candidate can be requested."}</p>
                        <button className="button primary" onClick={() => prepareBuddy(detail.candidate.id)} disabled={!canPrepare}>{busy === "buddy_prepare" ? "Preparing..." : `Prepare request for ${detail.candidate.full_name.split(" ")[0]}`}</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            <section className="panel" aria-label="Buddy request">
              <div className="panel-head"><h3>Request</h3>{request ? <Tag tone={requestTone(request.status)}>{requestLabel(request.status)}</Tag> : <span className="meta">none prepared</span>}</div>
              <div className="panel-body stack">
                {!request && <p className="muted small">No buddy request prepared. Prepare one from the selected candidate to see the exact draft and the three separate steps.</p>}
                {request && (
                  <>
                    <div className="facts">
                      <div><span>Candidate</span><strong>{request.candidate_name}</strong></div>
                      <div><span>Start date</span><strong>{formatDate(request.start_date)}</strong></div>
                      <div><span>{request.status === "confirmed" ? "Confirmed commitment" : "Proposed commitment"}</span><strong>{request.slots.length} sessions, first working week</strong></div>
                    </div>
                    <div className="slots">
                      {request.slots.map((slot) => <div className="slot" key={slot.id}><span className="kind">{slot.kind}</span><span className="when">{formatSlot(slot)}</span><span className="tz">{slot.duration_minutes} min · {slot.timezone}</span></div>)}
                    </div>
                    {current.buddy.draft && (
                      <div className="message">
                        <div className="message-avatar" aria-hidden="true">A</div>
                        <div>
                          <div className="message-head"><strong>{current.buddy.draft.subject}</strong><span>to {current.buddy.draft.recipient}</span><Tag tone="violet">Fixed mock template</Tag><Tag>{current.buddy.draft.status}</Tag></div>
                          <p>{current.buddy.draft.body}</p>
                          <p className="muted small">Draft content is fixed for this mock run. The live adapter is not used here.</p>
                        </div>
                      </div>
                    )}

                    <div className="steps">
                      <div className={`step ${stepState(1)}`}>
                        <span className="step-num" aria-hidden="true">1</span>
                        <div className="step-body">
                          <h4>People approves the exact request</h4>
                          {request.status === "pending_approval" && current.buddy.draft ? (
                            <div className="action-buttons"><button className="button secondary" onClick={() => decideBuddy("reject")} disabled={busy !== null}>Reject exact request</button><button className="button primary" onClick={() => decideBuddy("approve")} disabled={busy !== null}>{busy === "buddy_approve" ? "Sending..." : "Approve exact request"}</button></div>
                          ) : <p>{request.status === "rejected" ? "People rejected the request. No message was sent." : request.sent_at ? `Approved and sent ${formatDateTime(request.sent_at)}.${request.status === "superseded" ? ` Superseded afterwards: ${request.invalidation_reason ?? "current facts changed."}` : ""}` : request.status === "superseded" ? request.invalidation_reason ?? "Superseded before approval." : "Waiting."}</p>}
                        </div>
                      </div>
                      <div className={`step ${stepState(2)}`}>
                        <span className="step-num" aria-hidden="true">2</span>
                        <div className="step-body">
                          <h4>Buddy responds <span className="sim-badge">Simulated response</span></h4>
                          {request.status === "awaiting_acceptance" && current.buddy.after_approval?.status === "ok" ? (
                            <>
                              <p>Message receipt is recorded. No real buddy was contacted. Choose the response for this exact request.</p>
                              <div className="action-buttons"><button className="button secondary" onClick={() => simulateBuddyResponse("declined")} disabled={busy !== null}>{busy === "buddy_decline" ? "Recording..." : "Simulate buddy declines"}</button><button className="button primary" onClick={() => simulateBuddyResponse("accepted")} disabled={busy !== null}>{busy === "buddy_accept" ? "Recording..." : "Simulate buddy accepts"}</button></div>
                            </>
                          ) : <p>{request.response === "declined" ? `${request.candidate_name} declined this request${request.responded_at ? ` ${formatDateTime(request.responded_at)}` : ""}. No replacement request was sent automatically; choose another candidate.` : request.response === "accepted" ? `${request.candidate_name} accepted this request${request.responded_at ? ` ${formatDateTime(request.responded_at)}` : ""}.` : request.sent_at ? "Awaiting response." : "Waiting for approval first."}</p>}
                        </div>
                      </div>
                      <div className={`step ${stepState(3)}`}>
                        <span className="step-num" aria-hidden="true">3</span>
                        <div className="step-body">
                          <h4>People confirms the allocation</h4>
                          {request.status === "accepted" ? (
                            <>
                              <p>Acceptance is separate from confirmation. The allocation task completes only here.</p>
                              <div className="action-buttons"><button className="button primary" onClick={confirmBuddyAllocation} disabled={busy !== null}>{busy === "buddy_confirm" ? "Confirming..." : "Confirm allocation as People"}</button></div>
                            </>
                          ) : <p>{request.confirmed_at ? `Confirmed by ${request.confirmed_by_name ?? "the named People actor"}. ${request.candidate_name} is recorded on this case.` : request.response === "declined" ? "Not reached: buddy declined." : "Waiting for acceptance first."}</p>}
                        </div>
                      </div>
                    </div>

                    {request.status === "confirmed" && <div className="outcome positive" role="status"><span className="outcome-icon">✓</span><div><strong>Allocation confirmed by People.</strong><p>Buddy task completed by {request.confirmed_by_name ?? "the named People actor"}.</p></div></div>}
                    {request.status === "declined" && <div className="outcome unavailable" role="status"><span className="outcome-icon">!</span><div><strong>Buddy declined in simulation.</strong><p>Choose another current candidate on the left.</p></div></div>}
                    {request.status === "rejected" && <div className="outcome negative" role="status"><span className="outcome-icon">×</span><div><strong>People rejected the request.</strong><p>No message was sent. Choose another current candidate on the left.</p></div></div>}
                    {request.status === "superseded" && <div className="outcome unavailable" role="status"><span className="outcome-icon">!</span><div><strong>Request superseded by current facts.</strong><p>{request.invalidation_reason ?? "Availability or the start date changed."} Prepare a new request from the refreshed comparison.</p></div></div>}
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      </>
    );
  }

  function renderActivity(current: DemoResponse) {
    return (
      <>
        <div className="section-title"><h2>Activity</h2><p>Every step on this case, by actor. Source-of-truth history.</p></div>
        <div className="next-action"><strong>Next:</strong> {current.attention.equipment.status !== "On track" ? current.attention.equipment.next_action : current.attention.buddy.next_action}</div>
        <section className="panel" aria-label="Activity trace">
          <div className="panel-head"><h3>Trace</h3><span className="meta">{current.trace.length} events · <span className="trace-marker" style={{ display: "inline-block" }} /> system · <span className="trace-marker agent" style={{ display: "inline-block" }} /> agent · <span className="trace-marker human" style={{ display: "inline-block" }} /> human or simulation</span></div>
          <div className="trace">
            {current.trace.map((step, index) => (
              <div className="trace-row" key={`${step.kind}-${index}`}>
                <span className={`trace-marker ${step.actor}`} aria-hidden="true" />
                <span className="trace-actor">{step.actor}</span>
                <span className="trace-kind">{step.kind.replaceAll(".", " / ")}</span>
                <span className={`trace-summary ${IMPORTANT_TRACE.test(step.summary) ? "important" : ""}`}>{step.summary}</span>
              </div>
            ))}
          </div>
        </section>
        <details className="disclosure">
          <summary><span>Details</span><span className="meta">technical identifiers</span></summary>
          <div className="disclosure-body">
            <div className="ids">
              <div><span>run </span>{current.run_id}</div>
              <div><span>case </span>{current.case.id} · {current.case.state.replaceAll("_", " ")} · {current.case.task_count} tasks</div>
              <div><span>event </span>{current.facts.contract_event_id}</div>
              <div><span>model </span>{current.model.provider} · {current.model.model}</div>
              {current.draft && <div><span>equipment draft </span>{current.draft.id} · {current.draft.status}</div>}
              {current.buddy.request && <div><span>buddy request </span>{current.buddy.request.id} · {current.buddy.request.status}</div>}
              {current.buddy.draft && <div><span>buddy draft </span>{current.buddy.draft.id} · {current.buddy.draft.status}</div>}
            </div>
          </div>
        </details>
      </>
    );
  }

  /* ---------- layout ---------- */

  const workspace = (
    <div className="workspace">
      <span className="workspace-avatar" aria-hidden="true">Q</span>
      <div><strong>Quilstead Solutions</strong><span>Athena · onboarding</span></div>
    </div>
  );

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Workspace navigation">
        {workspace}
        <nav className="nav">{navButtons("side")}</nav>
        <div className="sidebar-foot">
          <span className="sim-badge">Simulated · no live send</span>
          <div className="sidebar-brand"><Image className="wordmark" src="/humaans-wordmark-white.svg" alt="Humaans" width={112} height={16} /><span>demo</span></div>
        </div>
      </aside>

      <div className="main">
        <div className="topnav">
          <div className="topnav-row">{workspace}<span className="sim-badge">Simulated</span></div>
          <nav className="tabs" aria-label="Sections">{navButtons("tab")}</nav>
        </div>

        <header className="case-header">
          <div className="case-identity">
            <span className="avatar" aria-hidden="true">{run ? initials(run.joiner.full_name) : "AO"}</span>
            <div>
              <h1>{run ? run.joiner.full_name : "Aisha Okafor"}</h1>
              <p>{run ? `${run.joiner.title} · ${run.joiner.office} · ${run.joiner.work_mode}` : "Customer Success Manager · London · hybrid"}</p>
              <div className="case-tags">
                {run ? <><Tag tone="info">{run.case.state.replaceAll("_", " ")}</Tag><Tag>{run.case.id}</Tag><Tag>{run.case.task_count} tasks</Tag><Tag tone="violet">{modelLabel(run.model.provider)}</Tag></> : <><Tag>J-004</Tag><Tag>No case loaded</Tag></>}
              </div>
            </div>
          </div>
          <div className="header-controls">
            <div className="field">
              <label htmlFor="start-date">Start date</label>
              <div className="field-row">
                <input id="start-date" className="date-input" type="date" value={dateDraft} onChange={(event) => setDateDraft(event.target.value)} disabled={!run || run.phase === "resolved" || busy !== null} />
                <button className="button secondary" onClick={changeStartDate} disabled={!run || run.phase === "resolved" || busy !== null || !dateDraft || dateDraft === run.joiner.start_date}>{busy === "date" ? "Recalculating..." : "Recalculate case"}</button>
              </div>
            </div>
            <div className="demo-controls">
              <span>Demo controls</span>
              <button className="button primary" onClick={startFlow} disabled={busy !== null}>{busy === "start" ? "Preparing case..." : run ? "Reset and prepare again" : "Prepare demo"}</button>
            </div>
          </div>
        </header>

        {error && <div className="error-banner" role="alert">{error}</div>}

        <main className="work">
          {!run && (
            <WorkflowTriggerCard busy={busy !== null} onTrigger={startFlow} />
          )}
          {run && section === "overview" && renderOverview(run)}
          {run && section === "equipment" && renderEquipment(run)}
          {run && section === "buddy" && renderBuddy(run)}
          {run && section === "activity" && renderActivity(run)}
        </main>

        <footer className="app-foot">Athena for Quilstead · mock systems only · no persistence · no live integrations</footer>
      </div>
    </div>
  );
}
