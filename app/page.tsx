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

interface DemoResponse {
  phase: "pending" | "resolved";
  screen_state: "awaiting_decision" | "draft_unavailable" | "no_action" | "resolved";
  run_id: string;
  decision?: DemoDecision;
  case: { id: string; state: string; start_date: string; task_count: number };
  joiner: { full_name: string; title: string; office: string; work_mode: string; start_date: string };
  model: { provider: "mock" | "anthropic"; model: string };
  equipment: { status: ToolResult["status"]; summary: string; eta: string | null };
  facts: DemoFacts;
  draft: DemoDraft | null;
  before_approval: ToolResult | null;
  after_approval?: ToolResult;
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
  const [busy, setBusy] = useState<"start" | "date" | DemoDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  function acceptRun(next: DemoResponse) {
    setRun(next);
    setDateDraft(next.joiner.start_date);
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
    setBusy("date");
    setError(null);
    try {
      acceptRun(await postDemo({ run_id: run.run_id, action: "retry_draft" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The draft retry failed");
    } finally {
      setBusy(null);
    }
  }

  const isPending = run?.screen_state === "awaiting_decision" && !!run.draft;
  const wasApproved = run?.decision === "approve";
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

          <section className="panel trace-panel">
            <div className="panel-kicker"><span>AGENT TRACE</span><span>{run.trace.length} events</span></div>
            <div className="trace-list">
              {run.trace.map((step, index) => (
                <div className="trace-row" key={`${step.kind}-${index}`}>
                  <span className={`trace-marker ${step.actor}`} />
                  <span className="trace-kind">{step.kind.replaceAll(".", " / ")}</span>
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
