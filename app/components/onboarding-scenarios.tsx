"use client";

import type { OnboardingView } from "@/lib/onboarding-view";

export type ScenarioKind = "access" | "profile" | "manager" | "joiner";
const labels: Record<ScenarioKind, string> = { access: "Access requests", profile: "Profile setup", manager: "Manager coordination", joiner: "New joiner questions" };
const systemLabels: Record<string, string> = { google_workspace: "Google Workspace", slack: "Slack", okta: "Okta", salesforce: "Salesforce", zendesk: "Zendesk", humaans: "Humaans", github: "GitHub", netsuite: "NetSuite" };
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(value));
const status = (value: string) => ({ open: "To do", overdue: "Overdue", done: "Complete", waiting_approval: "Awaiting approval", cancelled: "Cancelled" }[value] ?? value.replaceAll("_", " "));

export interface ManagerCoordinationView {
  request: {
    id: string; manager_name: string; status: "pending_approval" | "send_failed" | "awaiting_response" | "responded" | "confirmed" | "rejected" | "superseded";
    send_error?: string;
    arrival_time?: string; meeting_place?: string; first_day_outline?: string[]; items_to_bring?: string[]; confirmed_by_name?: string | null;
  } | null;
  draft: { id: string; recipient: string; subject?: string; body: string; status: "pending" | "approved" | "rejected" } | null;
}

export function OnboardingTasks({ tasks }: { tasks: OnboardingView["tasks"] }) {
  return <ul className="onboarding-task-list">{tasks.map((task) => <li key={task.id}><div><strong>{task.title}</strong><span>{task.owner_name} · Due {date(task.due_at)}</span></div><span className={`task-state task-${task.status}`}>{status(task.status)}</span></li>)}</ul>;
}

export function JoinerProfile({ view }: { view: OnboardingView }) {
  const profile = view.profile;
  return <section aria-label={`${profile.preferred_name}’s profile`} className="joiner-profile">
    <div className="profile-cover"><span className="profile-monogram" aria-hidden="true">{profile.name.split(" ").map((part) => part[0]).join("")}</span></div>
    <h2>{profile.name}</h2><p>{profile.title}</p><span className="profile-team">{profile.team}</span>
    <dl className="profile-fields"><div><dt>Preferred name</dt><dd>{profile.preferred_name}</dd></div><div><dt>Location</dt><dd>{profile.office} · {profile.work_mode}</dd></div><div><dt>Reports to</dt><dd>{profile.manager_name}</dd></div><div><dt>First day</dt><dd>{date(profile.start_date)}</dd></div></dl>
    <h3>Profile setup</h3><p className="scenario-note">These details are on file. The setup task below records whether the profile has been completed.</p>
    {profile.setup.length ? <OnboardingTasks tasks={profile.setup} /> : <p>Profile completion is not recorded.</p>}
  </section>;
}

export function OnboardingScenario({
  kind, view, compact, disabled, managerEditDisabled, onOpen, onAsk, onRequestAccess,
  managerCoordination, editingManager, managerEditSubject, managerEditBody,
  onPrepareManager, onBeginManagerEdit, onManagerEditSubject, onManagerEditBody,
  onSaveManagerEdit, onCancelManagerEdit, onManagerDecision, onSimulateManagerResponse, onConfirmManager,
}: {
  kind: ScenarioKind; view: OnboardingView; compact?: boolean; disabled: boolean; managerEditDisabled?: boolean;
  onOpen: (kind: ScenarioKind) => void; onAsk: (question: string) => void;
  onRequestAccess?: () => void;
  managerCoordination?: ManagerCoordinationView;
  editingManager?: boolean;
  managerEditSubject?: string;
  managerEditBody?: string;
  onPrepareManager?: () => void;
  onBeginManagerEdit?: () => void;
  onManagerEditSubject?: (value: string) => void;
  onManagerEditBody?: (value: string) => void;
  onSaveManagerEdit?: () => void;
  onCancelManagerEdit?: () => void;
  onManagerDecision?: (decision: "approve" | "reject") => void;
  onSimulateManagerResponse?: () => void;
  onConfirmManager?: () => void;
}) {
  const openProfile = view.profile.setup.some((task) => !["done", "cancelled"].includes(task.status));
  const preferredName = view.profile.preferred_name;
  const summary: Record<ScenarioKind, string> = {
    access: `${view.access.length} systems required for ${preferredName}’s role. ${view.access.filter((row) => row.request_id).length} requests submitted.`,
    profile: openProfile ? `${preferredName}’s details are on file. Profile setup still needs attention.` : `Review ${preferredName}’s details and profile setup status.`,
    manager: `${view.manager.name} owns the relationship. ${view.manager.tasks.filter((task) => !["done", "cancelled"].includes(task.status)).length} manager tasks remain.`,
    joiner: "First-day details, who to contact, and what still needs confirming.",
  };
  return <section className={`panel scenario-card scenario-${kind}`} aria-label={labels[kind]} data-workstream={kind}>
    <div className="panel-head"><h3>{labels[kind]}</h3></div><div className="panel-body">
      <p className="scenario-note">{summary[kind]}</p>
      {compact ? <button className="ask-link" onClick={() => onOpen(kind)} disabled={disabled}>{kind === "profile" ? `Open ${preferredName}’s profile` : `Explore ${labels[kind].toLowerCase()}`}</button> : <>
        {kind === "access" && <><div className="access-list">{view.access.map((row) => <div className="access-row" key={row.system}><span className="system-monogram" aria-hidden="true">{(systemLabels[row.system] ?? row.system)[0]}</span><div><strong>{systemLabels[row.system] ?? row.system}</strong><p>{row.level === "standard" ? "Standard access" : "Elevated access"} · Approval: {row.approver_name}</p><p>Owner: {row.owner_name}{row.due_at ? ` · Due ${date(row.due_at)}` : ""}</p>{row.request_id && <p>Receipt: {row.request_id}</p>}</div><span className="task-state">{row.request_id ? "Awaiting approval" : "Not submitted"}</span></div>)}</div><p className="scenario-note">This is the role’s access plan. A submitted request still needs the named approver’s decision; it does not confirm access.</p>{onRequestAccess && <button className="button primary" onClick={onRequestAccess} disabled={disabled}>{view.access.every((row) => row.request_id) ? "Check requests again" : `Request access required for ${preferredName}`}</button>}</>}
        {kind === "profile" && <><OnboardingTasks tasks={view.profile.setup} /><button className="button secondary" onClick={() => onOpen("profile")} disabled={disabled}>Open {preferredName}’s profile</button></>}
        {kind === "manager" && <>
          <div className="manager-contact"><span className="profile-monogram" aria-hidden="true">{view.manager.name.split(" ").map((part) => part[0]).join("")}</span><div><strong>{view.manager.name}</strong><span>{preferredName}’s manager</span></div></div>
          {view.manager.escalations.map((item) => <p className="scenario-note" key={item}>{item}</p>)}
          <OnboardingTasks tasks={view.manager.tasks} />
          {!managerCoordination?.request && <div className="confirmation-note"><strong>Still to confirm for day one</strong><p>Arrival time, where to meet and what to bring are not recorded.</p>{onPrepareManager && <button className="button primary" onClick={onPrepareManager} disabled={disabled}>Arrange first day with {view.manager.name}</button>}</div>}
          {managerCoordination?.request?.status === "pending_approval" && managerCoordination.draft && <div className="approval-card manager-approval">
            <div className="panel-head"><h3>Request preview</h3><span className="task-state">Awaiting your approval</span></div>
            {editingManager ? <div className="edit-form"><label>Subject<input value={managerEditSubject ?? ""} onChange={(event) => onManagerEditSubject?.(event.target.value)} /></label><label>Message<textarea rows={6} value={managerEditBody ?? ""} onChange={(event) => onManagerEditBody?.(event.target.value)} /></label><div className="approval-actions"><button className="button primary" onClick={onSaveManagerEdit} disabled={managerEditDisabled}>Save new version</button><button className="button secondary" onClick={onCancelManagerEdit} disabled={managerEditDisabled}>Cancel</button></div></div> : <><dl className="draft-preview"><div><dt>To</dt><dd>{managerCoordination.draft.recipient}</dd></div><div><dt>Subject</dt><dd>{managerCoordination.draft.subject}</dd></div><div><dt>Message</dt><dd>{managerCoordination.draft.body}</dd></div></dl><div className="approval-actions"><button className="button secondary" onClick={onBeginManagerEdit} disabled={disabled}>Edit</button><button className="button secondary" onClick={() => onManagerDecision?.("reject")} disabled={disabled}>Reject</button><button className="button primary" onClick={() => onManagerDecision?.("approve")} disabled={disabled}>Approve exact request</button></div></>}
          </div>}
          {managerCoordination?.request?.status === "send_failed" && managerCoordination.draft && <div className="confirmation-note" role="alert"><strong>Approved request was not delivered</strong><p>{managerCoordination.request.send_error ?? "The simulated send failed."} Your exact approval is preserved.</p><button className="button primary" onClick={() => onManagerDecision?.("approve")} disabled={disabled}>Retry approved request</button></div>}
          {managerCoordination?.request?.status === "awaiting_response" && <div className="confirmation-note"><strong>Awaiting {managerCoordination.request.manager_name}’s response</strong><p>The approved request was sent. The plan is not confirmed yet.</p><button className="button secondary" onClick={onSimulateManagerResponse} disabled={disabled}>Simulate {managerCoordination.request.manager_name} response</button><span className="ask-hint">Demo simulation</span></div>}
          {managerCoordination?.request?.status === "responded" && <div className="confirmation-note"><strong>Manager response ready for review</strong><p>Arrival {managerCoordination.request.arrival_time} · Meet at {managerCoordination.request.meeting_place}</p><ul>{managerCoordination.request.first_day_outline?.map((item) => <li key={item}>{item}</li>)}</ul><p>Bring: {managerCoordination.request.items_to_bring?.join(", ")}</p><button className="button primary" onClick={onConfirmManager} disabled={disabled}>Confirm first-day plan as People</button></div>}
          {managerCoordination?.request?.status === "confirmed" && <div className="confirmation-note"><strong>First-day plan confirmed</strong><p>Arrival {managerCoordination.request.arrival_time} · {managerCoordination.request.meeting_place}</p><p>Confirmed by {managerCoordination.request.confirmed_by_name ?? "People"}.</p></div>}
          {managerCoordination?.request && ["rejected", "superseded"].includes(managerCoordination.request.status) && <div className="confirmation-note"><strong>{managerCoordination.request.status === "rejected" ? "Request rejected" : "Plan needs reconfirmation"}</strong><p>Nothing current is waiting on the manager.</p>{onPrepareManager && <button className="button primary" onClick={onPrepareManager} disabled={disabled}>Prepare a new request</button>}</div>}
        </>}
        {kind === "joiner" && <><div className="first-day-facts"><div><span>First day</span><strong>{date(view.first_day.start_date)}</strong></div><div><span>Location</span><strong>{view.first_day.office} · {view.first_day.work_mode}</strong></div><div><span>People contact</span><strong>{view.first_day.people_contact}</strong></div></div><p className="scenario-note">Questions {preferredName} might ask. Review the answers here as the People contact.</p><div className="joiner-questions">{["What time should I arrive on my first day?", "What should I bring?", "Who is my manager?", "Who is the buddy?"].map((question) => <button className="ask-chip" key={question} disabled={disabled} onClick={() => onAsk(question)}>{question}<span aria-hidden="true">↗</span></button>)}</div><p className="scenario-note">Answers use {preferredName}’s current case. Unconfirmed details stay unconfirmed.</p></>}
      </>}
    </div>
  </section>;
}
