"use client";

import { useState } from "react";

type ToolResult = { status: "ok" | "warning" | "error" | "denied"; summary: string };
type DemoDecision = "approve" | "reject";

interface DemoResponse {
  phase: "pending" | "resolved";
  run_id: string;
  decision?: DemoDecision;
  case: { id: string; state: string; start_date: string; task_count: number };
  joiner: { full_name: string; title: string; office: string; work_mode: string; start_date: string };
  model: { provider: "mock" | "anthropic"; model: string };
  equipment: { status: ToolResult["status"]; summary: string; eta: string | null };
  draft: {
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
  };
  before_approval: ToolResult;
  after_approval?: ToolResult;
  trace: { actor: "system" | "agent" | "human"; kind: string; summary: string }[];
}

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

function modelLabel(provider: DemoResponse["model"]["provider"]) {
  return provider === "anthropic" ? "ANTHROPIC" : "MOCK MODEL";
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

export default function Home() {
  const [run, setRun] = useState<DemoResponse | null>(null);
  const [busy, setBusy] = useState<"start" | DemoDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startFlow() {
    setBusy("start");
    setError(null);
    try {
      setRun(await postDemo());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The demo flow failed");
    } finally {
      setBusy(null);
    }
  }

  async function decide(decision: DemoDecision) {
    if (!run) return;
    setBusy(decision);
    setError(null);
    try {
      setRun(await postDemo({ run_id: run.run_id, decision }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The approval action failed");
    } finally {
      setBusy(null);
    }
  }

  const isPending = run?.phase === "pending";
  const wasApproved = run?.decision === "approve";

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
          <p className="hero-copy">A single onboarding risk, turned into a grounded nudge and held for human approval.</p>
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
            <p>Start the flow to open Aisha&apos;s case, ask the model for one action-oriented Slack draft, and decide whether it may be sent.</p>
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
                <div><span>START DATE</span><strong>{formatDate(run.joiner.start_date)}</strong></div>
                <div><span>PLAN</span><strong>{run.case.task_count} tasks</strong></div>
                <div><span>MODEL</span><strong>{modelLabel(run.model.provider)}</strong></div>
              </div>
              <div className="risk-card">
                <div className="risk-icon">!</div>
                <div className="risk-content">
                  <div className="risk-label">ACTION NEEDED</div>
                  <h3>Laptop misses day one</h3>
                  <p>{run.equipment.summary}</p>
                  <div className="fact-grid">
                    <div><span>STARTS</span><strong>{formatDate(run.joiner.start_date)}</strong></div>
                    <div><span>ARRIVES</span><strong>{formatDate(run.equipment.eta)}</strong></div>
                    <div><span>GAP</span><strong>4 calendar days</strong></div>
                  </div>
                </div>
              </div>
            </article>

            <article className="panel approval-panel">
              <div className="panel-kicker"><span>APPROVAL QUEUE</span><span className={`decision-chip ${isPending ? "pending" : wasApproved ? "approved" : "rejected"}`}>{isPending ? "AWAITING DECISION" : wasApproved ? "SENT WITH APPROVAL" : "REJECTED"}</span></div>
              <div className="approval-heading">
                <p className="eyebrow">MODEL-PROPOSED ACTION</p>
                <h2>{run.draft.subject}</h2>
              </div>
              <div className="draft-meta"><span>TO {run.draft.recipient.toUpperCase()}</span><span>{run.draft.channel.toUpperCase()}</span><span>{modelLabel(run.model.provider)}</span></div>
              <div className="message-card">
                <div className="message-avatar">A</div>
                <div><strong>{run.draft.recipient}</strong><span className="message-channel"># onboarding-ops</span><p>{run.draft.body}</p></div>
              </div>
              {isPending ? (
                <div className="approval-actions">
                  <p>This message is a draft. Your decision is the only path to send.</p>
                  <div className="action-buttons">
                    <button className="button secondary" onClick={() => decide("reject")} disabled={busy !== null}>Reject draft</button>
                    <button className="button primary" onClick={() => decide("approve")} disabled={busy !== null}>{busy === "approve" ? "Sending..." : "Approve and send"}<span aria-hidden="true">↗</span></button>
                  </div>
                </div>
              ) : (
                <div className={`resolution-card ${wasApproved ? "positive" : "negative"}`}>
                  <span className="resolution-icon">{wasApproved ? "✓" : "×"}</span>
                  <div><strong>{wasApproved ? "Sent through the approved Slack action." : "Nothing was sent."}</strong><p>{run.after_approval?.summary}</p></div>
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
