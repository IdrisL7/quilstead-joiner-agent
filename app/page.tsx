"use client";

import { useState } from "react";

type ToolResult = { status: "ok" | "warning" | "error" | "denied"; summary: string };
type DemoDecision = "approve" | "reject";

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
  return provider === "anthropic" ? "ANTHROPIC" : "MOCK MODEL";
}

function gapLabel(gapDays: number) {
  if (gapDays === 0) return "Same day as first day";
  const days = Math.abs(gapDays);
  return `${days} calendar ${days === 1 ? "day" : "days"} ${gapDays > 0 ? "after" : "before"} first day`;
}

type ApprovalPanelRun = {
  screen_state: DemoResponse["screen_state"];
  facts: Pick<DemoFacts, "equipment_late" | "start_date" | "equipment_eta">;
};

export function ApprovalEmptyState({ run }: { run: ApprovalPanelRun }) {
  if (run.screen_state === "draft_unavailable") {
    return (
      <div className="no-action-heading unavailable-heading">
        <p className="eyebrow">MODEL-PROPOSED ACTION</p>
        <h2>Draft unavailable. Equipment risk remains</h2>
        <p>The current ETA is still after the current start date. Retry drafting before any message can be sent.</p>
      </div>
    );
  }

  if (run.screen_state === "no_action" && !run.facts.equipment_late) {
    return (
      <div className="no-action-heading">
        <p className="eyebrow">MODEL-PROPOSED ACTION</p>
        <h2>No message needed</h2>
        <p>The current ETA precedes the current start date, so the superseded draft is not available to send.</p>
      </div>
    );
  }

  return null;
}

function AttentionSummaryPanel({ summary }: { summary: AttentionSummary }) {
  const items = [
    { key: "equipment", label: "Equipment", data: summary.equipment, detail: "Current ETA and approval state" },
    { key: "buddy", label: "Buddy support", data: summary.buddy, detail: summary.buddy.candidate_name ?? "No candidate selected" },
    { key: "compliance", label: "Compliance", data: summary.compliance, detail: `${summary.compliance.open_tasks} of ${summary.compliance.total_tasks} task${summary.compliance.total_tasks === 1 ? "" : "s"} open` },
  ];
  return (
    <section className="panel attention-panel" aria-labelledby="attention-heading">
      <div className="panel-kicker"><span id="attention-heading">ATTENTION SUMMARY</span><span>current case state</span></div>
      <div className="attention-grid">
        {items.map((item) => (
          <article className="attention-card" key={item.key}>
            <div className="attention-card-top"><span className="attention-label">{item.label}</span><span className={`attention-status ${attentionTone(item.data.status)}`}>{item.data.status}</span></div>
            <strong>{item.detail}</strong>
            <p>Owner: {item.data.owner_name}</p>
            <span className="attention-next">Next: {item.data.next_action}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function BuddyCandidateCard({
  assessment,
  selected,
  recommended,
  request,
  canRequest,
  onRequest,
}: {
  assessment: BuddyCandidateAssessment;
  selected: boolean;
  recommended: boolean;
  request: BuddyRequest | null;
  canRequest: boolean;
  onRequest: (candidateId: string) => void;
}) {
  const { candidate, eligibility, availability } = assessment;
  const isRequested = request?.candidate_id === candidate.id;
  const canChoose = canRequest && eligibility.eligible && availability.status === "available";
  return (
    <article className={`candidate-card ${selected ? "selected" : ""} ${isRequested ? "requested" : ""} ${recommended ? "recommended" : ""}`}>
      <div className="candidate-card-top">
        <div className="candidate-identity"><span className="candidate-avatar">{initials(candidate.full_name)}</span><div><h4>{candidate.full_name}</h4><p>{candidate.team} / {candidate.office}</p></div></div>
        <div className="candidate-tags">{recommended && <span className="candidate-recommended">Recommended</span>}<span className={`candidate-eligibility ${eligibility.eligible ? "eligible" : "ineligible"}`}>{eligibility.eligible ? "Eligible" : "Not eligible"}</span></div>
      </div>
      <div className="candidate-metrics"><span>{candidate.active_buddies} active assignment{candidate.active_buddies === 1 ? "" : "s"}</span><span>{candidate.tenure_months} months tenure</span></div>
      <div className={`candidate-availability ${availability.status}`}><strong>{availabilityLabel(availability.status)}</strong><span>{availability.reason}</span></div>
      {eligibility.reasons.length > 0 && (
        <ul className="candidate-reasons">
          {eligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      {availability.slots.length > 0 && (
        <div className="candidate-slots">
          <span className="source-label">PROPOSED FIRST-WEEK SLOTS</span>
          {availability.slots.map((slot) => <span key={slot.id}><strong>{slot.kind}</strong> {formatSlot(slot)} <em>{slot.timezone}</em></span>)}
        </div>
      )}
      <div className="candidate-card-footer">
        {isRequested && <span className="requested-note">Current request</span>}
        {canChoose && <button className="button secondary candidate-button" onClick={() => onRequest(candidate.id)}>Request {candidate.full_name}</button>}
      </div>
    </article>
  );
}

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

function decisionLabel(run: DemoResponse) {
  if (run.screen_state === "awaiting_decision") return "AWAITING DECISION";
  if (run.screen_state === "draft_unavailable") return "DRAFT UNAVAILABLE";
  if (run.screen_state === "no_action") return "RISK CLEARED";
  return run.decision === "approve" ? "SENT WITH APPROVAL" : "REJECTED";
}

function decisionClass(run: DemoResponse) {
  if (run.screen_state === "awaiting_decision") return "pending";
  if (run.screen_state === "draft_unavailable") return "failed";
  if (run.screen_state === "no_action" || run.decision === "approve") return "approved";
  return "rejected";
}

export default function Home() {
  const [run, setRun] = useState<DemoResponse | null>(null);
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
      acceptRun(await postDemo());
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
  const timelineItems = run ? [
    { key: "contract", at: run.facts.contract_signed_at, date: formatDateTime(run.facts.contract_signed_at), title: "Contract signed", detail: `${run.facts.contract_event_id} received`, tone: "" },
    { key: "equipment-task", at: run.facts.equipment_task_due_at, date: `Due ${formatDateTime(run.facts.equipment_task_due_at)}`, title: run.facts.equipment_task_title, detail: `Owner: ${run.facts.equipment_owner_name}`, tone: "" },
    { key: "start", at: `${run.facts.start_date}T00:00:00Z`, date: formatDate(run.facts.start_date), title: "First day", detail: `${run.joiner.office} / ${run.joiner.work_mode}`, tone: "" },
    { key: "delivery", at: `${run.facts.equipment_eta}T00:00:00Z`, date: `ETA ${formatDate(run.facts.equipment_eta)}`, title: "Equipment delivery", detail: `${gapLabel(run.facts.gap_days)} / ${run.facts.equipment_owner_name}`, tone: run.facts.equipment_late ? "risk" : "cleared" },
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at)) : [];

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">A</span>
          <span className="brand-name">ATHENA</span>
          <span className="brand-context">JOINER READINESS</span>
        </div>
        <div className="environment-pill"><span className="status-dot" /> SIMULATED / NO LIVE SEND</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">ONE BOUNDED AGENT FLOW</p>
          <h1>Make day one feel prepared.</h1>
          <p className="hero-copy">One onboarding risk, grounded in current facts and held for human approval.</p>
        </div>
        <button className="button primary hero-button" onClick={startFlow} disabled={busy !== null}>
          {busy === "start" ? "Preparing case..." : run ? "Run a new case" : "Generate model nudge"}
          <span aria-hidden="true">↗</span>
        </button>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {!run && (
        <section className="empty-state panel">
          <div className="empty-index">01</div>
          <div>
            <p className="eyebrow">READY WHEN YOU ARE</p>
            <h2>Review one real decision boundary</h2>
            <p>Open Aisha&apos;s case, inspect the evidence behind one equipment nudge, then decide whether the simulated Slack action may run.</p>
          </div>
          <div className="empty-facts">
            <span>J-004</span><span>UK / London</span><span>14 planned tasks</span>
          </div>
        </section>
      )}

      {run && (
        <>
          <AttentionSummaryPanel summary={run.attention} />
          <section className="flow-grid">
            <article className="panel case-panel">
              <div className="panel-kicker"><span>CASE / {run.case.id}</span><span className="state-chip">{run.case.state.replaceAll("_", " ")}</span></div>
              <div className="case-heading">
                <div>
                  <p className="eyebrow">NEW JOINER</p>
                  <h2>{run.joiner.full_name}</h2>
                  <p>{run.joiner.title} <span className="muted-separator">/</span> {run.joiner.office} <span className="muted-separator">/</span> {run.joiner.work_mode}</p>
                </div>
                <div className="avatar">AO</div>
              </div>
              <div className="metric-row">
                <div><span>START DATE</span><strong>{formatDate(run.facts.start_date)}</strong></div>
                <div><span>PLAN</span><strong>{run.case.task_count} tasks</strong></div>
                <div><span>MODEL</span><strong>{modelLabel(run.model.provider)}</strong></div>
              </div>

              <div className="section-heading">
                <div><p className="eyebrow">CURRENT CASE TIMELINE</p><h3>What the agent knows now</h3></div>
                <span className="section-note">source facts</span>
              </div>
              <ol className="timeline" aria-label="Current onboarding case timeline">
                {timelineItems.map((item) => (
                  <li className={`timeline-item ${item.tone}`} key={item.key}>
                    <span className="timeline-dot" aria-hidden="true" />
                    <div className="timeline-content"><span className="timeline-date">{item.date}</span><strong>{item.title}</strong><span>{item.detail}</span></div>
                  </li>
                ))}
              </ol>

              <div className={`risk-card ${run.facts.equipment_late ? "" : "cleared"}`}>
                <div className="risk-icon">{run.facts.equipment_late ? "!" : "✓"}</div>
                <div className="risk-content">
                  <div className="risk-label">{run.facts.equipment_late ? "ACTION NEEDED" : "CURRENT STATE"}</div>
                  <h3>{run.facts.equipment_late ? "Laptop misses day one" : "Laptop is on track for day one"}</h3>
                  <p>{run.facts.equipment_late ? run.equipment.summary : `The ${formatDate(run.facts.equipment_eta)} ETA now precedes the ${formatDate(run.facts.start_date)} start.`}</p>
                  <div className="fact-grid">
                    <div><span>STARTS</span><strong>{formatDate(run.facts.start_date)}</strong></div>
                    <div><span>ARRIVES</span><strong>{formatDate(run.facts.equipment_eta)}</strong></div>
                    <div><span>RELATION</span><strong>{gapLabel(run.facts.gap_days)}</strong></div>
                  </div>
                </div>
              </div>

              <div className="date-control">
                <div className="date-control-heading"><div><p className="eyebrow">HRIS EVENT</p><h3>Change the start date</h3></div><span className="section-note">same case, recalculated</span></div>
                <div className="date-control-row">
                  <label htmlFor="start-date">New start date</label>
                  <input id="start-date" className="date-input" type="date" value={dateDraft} onChange={(event) => setDateDraft(event.target.value)} disabled={run.phase === "resolved" || busy !== null} />
                  <button className="button secondary" onClick={changeStartDate} disabled={run.phase === "resolved" || busy !== null || !dateDraft || dateDraft === run.joiner.start_date}>
                    {busy === "date" ? "Recalculating..." : "Recalculate case"}
                  </button>
                </div>
                <p>Deadlines and risks are recalculated from the current case. The case identity, equipment ETA and completed work remain intact.</p>
              </div>

              {run.date_change && (
                <div className="date-change-summary" role="status">
                  <div className="date-change-top"><span className="eyebrow">LATEST CHANGE</span><strong>{formatDate(run.date_change.previous_start_date)} <span aria-hidden="true">→</span> {formatDate(run.date_change.new_start_date)}</strong></div>
                  <p>{run.date_change.risk_before && !run.date_change.risk_after ? "Late-arrival risk cleared from the current dates. The pending draft was superseded." : run.date_change.risk_after ? "Late-arrival risk remains from the current dates. A fresh draft is available for review." : "The current case was recalculated from the new start date."}</p>
                  <div className="change-stats"><span>{run.date_change.deadlines_changed} deadlines moved</span><span>{run.date_change.tasks_changed} tasks reconciled</span><span>{run.date_change.tasks_unchanged} unchanged</span></div>
                </div>
              )}
            </article>

            <article className="panel approval-panel">
              <div className="panel-kicker"><span>APPROVAL QUEUE</span><span className={`decision-chip ${decisionClass(run)}`}>{decisionLabel(run)}</span></div>
              {run.draft ? (
                <>
                  <div className="approval-heading">
                    <p className="eyebrow">MODEL-PROPOSED ACTION</p>
                    <h2>{run.draft.subject}</h2>
                  </div>
                  <div className="draft-meta"><span>TO {run.draft.recipient.toUpperCase()}</span><span>{run.draft.channel.toUpperCase()}</span><span>{modelLabel(run.model.provider)}</span></div>
                  <div className="message-card">
                    <div className="message-avatar">A</div>
                    <div><strong>{run.draft.recipient}</strong><span className="message-channel"># onboarding-ops</span><p>{run.draft.body}</p></div>
                  </div>
                </>
              ) : <ApprovalEmptyState run={run} />}

              <details className="evidence-panel">
                <summary><span>Why this?</span><span className="summary-meta">facts + policy source</span></summary>
                <div className="evidence-body">
                  <p className="evidence-intro">The recommendation is grounded in the current case snapshot. Generated wording is kept separate from source facts.</p>
                  <div className="evidence-grid">
                    <div><span>START DATE</span><strong>{formatDate(run.facts.start_date)}</strong></div>
                    <div><span>EQUIPMENT ETA</span><strong>{formatDate(run.facts.equipment_eta)}</strong></div>
                    <div><span>TASK DEADLINE</span><strong>{formatDateTime(run.facts.equipment_task_due_at)}</strong></div>
                    <div><span>OWNER</span><strong>{run.facts.equipment_owner_name}</strong></div>
                  </div>
                  <div className="source-block"><span className="source-label">SOURCE POLICY / {run.facts.policy_page_id}</span><blockquote>“{run.facts.policy_quote}”</blockquote></div>
                  <div className="approval-requirement"><span className="source-label">HUMAN GATE</span><p>{run.facts.approval_required}</p></div>
                </div>
              </details>

              {isPending ? (
                <div className="approval-actions">
                  <p>Draft awaiting your approval</p>
                  <div className="action-buttons">
                    <button className="button secondary" onClick={() => decide("reject")} disabled={busy !== null}>Reject draft</button>
                    <button className="button primary" onClick={() => decide("approve")} disabled={busy !== null}>{busy === "approve" ? "Sending..." : "Approve and send"}<span aria-hidden="true">↗</span></button>
                  </div>
                </div>
              ) : run.screen_state === "draft_unavailable" ? (
                <div className="resolution-card unavailable" role="alert">
                  <span className="resolution-icon">!</span>
                  <div><strong>Draft unavailable.</strong><p>{run.draft_unavailable?.message}</p><button className="button secondary retry-button" onClick={retryDraft} disabled={busy !== null}>{busy === "date" ? "Retrying..." : "Retry draft"}</button></div>
                </div>
              ) : run.screen_state === "no_action" ? (
                <div className="resolution-card positive" role="status">
                  <span className="resolution-icon">✓</span>
                  <div><strong>Risk cleared from current dates.</strong><p>No outbound action was sent. Choose another date to recalculate the same case.</p></div>
                </div>
              ) : (
                <div className={`resolution-card ${wasApproved ? "positive" : "negative"}`} role="status">
                  <span className="resolution-icon">{wasApproved ? "✓" : "×"}</span>
                  <div><strong>{wasApproved ? "Sent with approval. Awaiting IT response." : "Nothing was sent."}</strong><p>{run.after_approval?.summary}</p></div>
                </div>
              )}
            </article>
          </section>

          <section className="panel buddy-panel" aria-labelledby="buddy-support-heading">
            <div className="panel-kicker"><span id="buddy-support-heading">BUDDY SUPPORT</span><span className="simulation-badge">SIMULATED CALENDAR / NO INVITE</span></div>
            <div className="buddy-panel-heading">
              <div>
                <p className="eyebrow">PEOPLE DECISION</p>
                <h2>Find support for Aisha&apos;s first week.</h2>
                <p>Eligibility, capacity, calendar evidence and willingness stay separate. The request is not sent until People approves this exact preview.</p>
              </div>
              {simulationCandidate && (
                <button className="button secondary simulation-button" onClick={() => simulateAvailability(simulationCandidate.candidate.id)} disabled={busy !== null}>
                  {busy === "availability" ? "Refreshing calendar..." : `Simulate ${simulationCandidate.candidate.full_name} unavailable`}
                </button>
              )}
            </div>

            <div className="comparison-heading"><div><p className="eyebrow">CANDIDATE COMPARISON</p><h3>Current policy and calendar snapshot</h3></div><span className="section-note">top {buddyCandidates.length} of {run.buddy.availability.candidates.length}</span></div>
            <div className="candidate-grid">
              {buddyCandidates.map((assessment) => (
                <BuddyCandidateCard
                  key={assessment.candidate.id}
                  assessment={assessment}
                  selected={selectedCandidateId === assessment.candidate.id}
                  recommended={recommendedBuddy?.candidate_id === assessment.candidate.id}
                  request={buddyRequest}
                  canRequest={!hasActiveBuddy && busy === null}
                  onRequest={prepareBuddy}
                />
              ))}
            </div>

            {run.buddy.availability.escalation && !run.buddy.availability.recommendation && (
              <div className="buddy-escalation" role="status"><strong>People review required</strong><p>{run.buddy.availability.escalation.summary}</p></div>
            )}

            <div className="request-preview">
              <div className="comparison-heading request-heading"><div><p className="eyebrow">REQUEST PREVIEW</p><h3>One exact commitment, held for approval</h3></div>{buddyRequest && <span className={`request-status ${buddyRequest.status}`}>{requestLabel(buddyRequest.status)}</span>}</div>
              {!buddyRequest && (
                <div className="request-empty"><strong>No buddy request prepared.</strong><p>Select an eligible candidate with two known slots to create a fixed request preview. No message is sent by comparing candidates.</p></div>
              )}
              {buddyRequest && (
                <div className="request-preview-card">
                  <div className="request-card-top"><div><span className="source-label">CANDIDATE</span><strong>{buddyRequest.candidate_name}</strong></div><div><span className="source-label">START DATE</span><strong>{formatDate(buddyRequest.start_date)}</strong></div><div><span className="source-label">REQUEST ID</span><strong>{buddyRequest.id}</strong></div></div>
                  {run.buddy.draft && (
                    <div className="buddy-message-preview">
                      <div className="draft-preview-label"><span className="source-label">EXACT DRAFT / {run.buddy.draft.status.toUpperCase()}</span><span className="simulation-badge">FIXED MOCK TEMPLATE</span></div>
                      <h4>{run.buddy.draft.subject}</h4>
                      <p>{run.buddy.draft.body}</p>
                      <span className="draft-boundary">Draft content is fixed for this mock run. The live adapter is not used here.</span>
                    </div>
                  )}
                  <div className="request-slots"><div className="request-slots-heading"><span className="source-label">{buddyRequest.status === "confirmed" ? "CONFIRMED COMMITMENT" : "PROPOSED COMMITMENT"}</span><span>{buddyRequest.slots.length} sessions / first working week</span></div>{buddyRequest.slots.map((slot) => <div className="request-slot" key={slot.id}><span className="slot-kind">{slot.kind}</span><strong>{formatSlot(slot)}</strong><span>{slot.duration_minutes} min / {slot.timezone}</span></div>)}</div>

                  {buddyRequest.status === "pending_approval" && run.buddy.draft && (
                    <div className="buddy-actions approval-actions"><p>Draft awaiting your approval</p><div className="action-buttons"><button className="button secondary" onClick={() => decideBuddy("reject")} disabled={busy !== null}>Reject exact request</button><button className="button primary" onClick={() => decideBuddy("approve")} disabled={busy !== null}>{busy === "buddy_approve" ? "Sending..." : "Approve exact request"}<span aria-hidden="true">↗</span></button></div></div>
                  )}
                  {buddyRequest.status === "awaiting_acceptance" && run.buddy.after_approval?.status === "ok" && (
                    <div className="simulation-response" role="status"><div className="simulation-response-heading"><span className="simulation-badge">SIMULATED RESPONSE</span><strong>Message receipt is recorded. No real buddy was contacted.</strong></div><p>Choose the response for this exact request. Acceptance is separate from People confirmation.</p><div className="action-buttons"><button className="button secondary" onClick={() => simulateBuddyResponse("declined")} disabled={busy !== null}>{busy === "buddy_decline" ? "Recording..." : "Simulate buddy declines"}</button><button className="button primary" onClick={() => simulateBuddyResponse("accepted")} disabled={busy !== null}>{busy === "buddy_accept" ? "Recording..." : "Simulate buddy accepts"}</button></div></div>
                  )}
                  {buddyRequest.status === "accepted" && (
                    <div className="simulation-response accepted-response" role="status"><div className="simulation-response-heading"><span className="simulation-badge">SIMULATED ACCEPTANCE</span><strong>{buddyRequest.candidate_name} accepted this request.</strong></div><p>People confirmation is still required before the allocation task can complete.</p><button className="button primary" onClick={confirmBuddyAllocation} disabled={busy !== null}>{busy === "buddy_confirm" ? "Confirming..." : "Confirm allocation as People"}</button></div>
                  )}
                  {buddyRequest.status === "confirmed" && (
                    <div className="resolution-card positive buddy-resolution" role="status"><span className="resolution-icon">✓</span><div><strong>Allocation confirmed by People.</strong><p>{buddyRequest.candidate_name} is recorded on this case. The task was completed by {buddyRequest.confirmed_by_name ?? "the named People actor"}.</p></div></div>
                  )}
                  {buddyRequest.status === "declined" && (
                    <div className="resolution-card unavailable buddy-resolution" role="status"><span className="resolution-icon">!</span><div><strong>Buddy declined in simulation.</strong><p>No replacement request was sent automatically. Choose another current candidate above.</p></div></div>
                  )}
                  {buddyRequest.status === "rejected" && (
                    <div className="resolution-card negative buddy-resolution" role="status"><span className="resolution-icon">×</span><div><strong>People rejected the request.</strong><p>No message was sent. Choose another current candidate above.</p></div></div>
                  )}
                  {buddyRequest.status === "superseded" && (
                    <div className="resolution-card unavailable buddy-resolution" role="status"><span className="resolution-icon">!</span><div><strong>Request superseded by current facts.</strong><p>{buddyRequest.invalidation_reason ?? "Availability or the start date changed."} Prepare a new request from the refreshed comparison.</p></div></div>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="panel trace-panel">
            <div className="panel-kicker"><span>AGENT TRACE</span><span>{run.trace.length} events / source-of-truth history</span></div>
            <div className="trace-legend"><span><i className="trace-legend-dot system" /> system</span><span><i className="trace-legend-dot agent" /> agent</span><span><i className="trace-legend-dot human" /> human or simulation input</span></div>
            <div className="trace-list">
              {run.trace.map((step, index) => (
                <div className="trace-row" key={`${step.kind}-${index}`}>
                  <span className={`trace-marker ${step.actor}`} />
                  <span className="trace-kind">{step.kind.replaceAll(".", " / ")}</span>
                  <span className="trace-actor">{step.actor}</span>
                  <span className="trace-summary">{step.summary}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <footer><span>ATHENA / QUILSTEAD</span><span>Mock systems only. No persistence. No live integrations.</span></footer>
    </main>
  );
}
