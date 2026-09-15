"use client";

import { useEffect, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import Image from "next/image";
import type { OnboardingView } from "@/lib/onboarding-view";
import { JoinerProfile, OnboardingScenario, OnboardingTasks, type ScenarioKind } from "./components/onboarding-scenarios";
import { askIntentFor } from "@/lib/ask-intent";
import { DEMO_TRIGGER_PREVIEW } from "@/data/demo-trigger";
import { firstWorkingWeek } from "@/lib/policy/buddy-availability";

type ToolResult = { status: "ok" | "warning" | "error" | "denied"; summary: string };
type DemoDecision = "approve" | "reject";
type Section = "overview" | "equipment" | "buddy" | "activity" | "profile";

type WorkFocus = "all" | "equipment" | "buddy" | "compliance" | "dates" | "answer" | ScenarioKind;
const FOCUS_LABELS: Record<WorkFocus, string> = { all: "Onboarding readiness", equipment: "Equipment", buddy: "Buddy support", compliance: "Compliance", dates: "Start date", answer: "Your question", access: "Access requests", profile: "Profile setup", manager: "Manager coordination", joiner: "New joiner questions" };
export function workFocusFor(question: string, card?: "equipment" | "buddy" | "timeline" | null): WorkFocus {
  const intent = askIntentFor(question);
  if (intent === "profile" || intent === "access" || intent === "manager" || intent === "joiner") return intent;
  if (intent === "equipment" || intent === "buddy" || intent === "compliance") return intent;
  if (intent === "date_question" || startDateRequestFor(question, "2026-10-12")) return "dates";
  if (intent === "status") return "all";
  if (card === "equipment" || card === "buddy") return card;
  return "answer";
}

function BotanicalWelcome({ entry = false, focus = "all", joinerName = "Aisha Okafor", preferredName = "Aisha" }: { entry?: boolean; focus?: WorkFocus; joinerName?: string; preferredName?: string }) {
  return <div className={`botanical-welcome ${entry ? "welcome-entry" : "welcome-current"}`}>
    <Image src="/onboarding-botanicals.png" alt="" fill priority={entry} sizes="(max-width: 768px) 100vw, 880px" />
    <div className="welcome-copy"><span className="welcome-eyebrow">A little care before day one</span>
      <h2>{entry ? "A great first day starts here." : FOCUS_LABELS[focus]}</h2>
      <p>{entry ? `You’re supporting ${preferredName} from the People team. Athena checks what needs attention; you review and approve the next steps.` : `${joinerName} · Quilstead Solutions`}</p>
    </div>
  </div>;
}


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
  revision?: number;
  edited_by?: string;
  edited_at?: string;
  supersedes_draft_id?: string;
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

interface BuddyBusyInterval {
  start_at: string;
  end_at: string;
}

interface BuddyWorkingHours {
  start_local: string;
  end_local: string;
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
    working_hours?: BuddyWorkingHours;
    coverage_start_date?: string;
    coverage_end_date?: string;
    busy_intervals?: BuddyBusyInterval[];
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

interface AgentSummary {
  run_id: string;
  trigger: string;
  provider: "mock" | "anthropic";
  model: string;
  steps: number;
  tool_calls: number;
  refused: number;
  proposed: number;
  escalated: number;
  stop_reason: string;
  next_action: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  started_at: string;
  finished_at: string;
}

type AskLink = "overview" | "equipment" | "buddy" | "activity";

interface AskAnswer {
  answer: string;
  links: AskLink[];
  card?: "equipment" | "buddy" | "timeline" | null;
  facts: string[];
  provider: "mock" | "anthropic" | "system";
  clarification?: "person";
  switch_joiner_id?: string;
  model: string;
  cost_usd: number;
}

interface AskHistoryItem {
  id: string;
  question: string;
  answer: AskAnswer;
  snapshot: DemoResponse;
}

type DateChangeRequest =
  | { kind: "confirm"; history_id: string; date: string; label: string; status: "pending" | "confirmed" | "dismissed" }
  | { kind: "clarify"; history_id: string; message: string };

interface StartDateRequestInterpretation {
  kind: "confirm" | "clarify";
  date?: string;
  label?: string;
  message?: string;
}

interface DemoResponse {
  onboarding?: OnboardingView;
  phase: "pending" | "resolved";
  next_action: string | null;
  screen_state: "awaiting_decision" | "draft_unavailable" | "no_action" | "resolved";
  run_id: string;
  available_joiners: Array<{ id: string; case_id: string; full_name: string; title: string; start_date: string; opened: boolean }>;
  decision?: DemoDecision;
  case: { id: string; state: string; start_date: string; task_count: number; open_task_count?: number; buddy_id: string | null; buddy_task_status: string | null; buddy_task_done_by: string | null };
  joiner: { id: string; full_name: string; title: string; office: string; work_mode: string; start_date: string };
  model: { provider: "mock" | "anthropic"; model: string };
  agent: AgentSummary | null;
  equipment: { status: ToolResult["status"]; summary: string; eta: string | null; source_revision?: number };
  equipment_observation?: { source_revision: number; eta: string; status: string; signature: string };
  facts: DemoFacts;
  draft: DemoDraft | null;
  before_approval: ToolResult | null;
  after_approval?: ToolResult;
  attention: AttentionSummary;
  buddy: BuddyState;
  manager_coordination: {
    request: {
      id: string; manager_id: string; manager_name: string; draft_id: string; start_date: string;
      status: "pending_approval" | "awaiting_response" | "responded" | "confirmed" | "rejected" | "superseded";
      sent_at?: string; response_at?: string; arrival_time?: string; meeting_place?: string;
      first_day_outline?: string[]; items_to_bring?: string[]; confirmed_at?: string; confirmed_by_name?: string | null;
    } | null;
    draft: { id: string; recipient: string; subject?: string; body: string; status: "pending" | "approved" | "rejected"; revision?: number; supersedes_draft_id?: string } | null;
  };
  date_change?: DemoDateChange;
  draft_unavailable?: { message: string };
  answer?: AskAnswer;
  recovery?: "equipment_reassessment";
  trace: { actor: "system" | "agent" | "human"; kind: string; summary: string }[];
  source_update?: ToolResult & { data?: { changed?: boolean; eta?: string; source_revision?: number } };
}

interface MonitorCaseSnapshot {
  case_id: string;
  joiner_id: string;
  state: "watching" | "checking" | "needs_attention" | "paused";
  last_checked_at: string | null;
  last_successful_check_at: string | null;
  last_error: string | null;
  next_action: string | null;
}

interface MonitorNotification {
  id: string;
  case_id: string;
  joiner_id: string;
  at: string;
  source_revision: number;
  equipment_eta: string;
  start_date: string;
  outcome: "proposal_prepared" | "risk_cleared";
  draft_id: string | null;
}

interface MonitorSnapshot {
  running: boolean;
  provider: "mock" | "anthropic";
  agent_invocations: number;
  max_agent_invocations: number;
  cases: MonitorCaseSnapshot[];
  notifications: MonitorNotification[];
}

interface DemoSnapshotResponse {
  busy: boolean;
  monitor: MonitorSnapshot;
  cases: DemoResponse[];
}

// The server computes one next action from the current case state (the assistant's
// recommendation while nothing has changed since its run, the attention state afterwards).
function agentNextAction(run: DemoResponse, fallback: string): string {
  return run.next_action ?? fallback;
}

function overallAttentionNextAction(run: DemoResponse): string {
  if (run.next_action) return run.next_action;
  return run.attention.equipment.status !== "On track"
    ? run.attention.equipment.next_action
    : run.attention.buddy.next_action;
}

export interface ExecutionStep {
  key: "event" | "case" | "tasks" | "equipment" | "buddy" | "approval";
  label: string;
  status: "complete" | "attention";
  detail: string;
}

type ExecutionSummaryRun = Pick<DemoResponse, "case" | "facts" | "equipment" | "draft" | "buddy" | "trace">;

export function initialExecutionFor(
  current: ExecutionSummaryRun | null,
  next: ExecutionSummaryRun,
  replace: boolean,
): ExecutionSummaryRun {
  return current === null || replace ? next : current;
}

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
        ? "Draft prepared for approval during initial checks."
        : "No equipment action was required during initial checks.",
    },
  ];
}

/* ---------- formatting ---------- */

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

const MONTH_NUMBERS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

function isoDateForParts(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function requestedDateFrom(question: string, currentStartDate: string): string | null {
  const year = Number(currentStartDate.slice(0, 4));
  const iso = question.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return isoDateForParts(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const numeric = question.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/);
  if (numeric) return isoDateForParts(numeric[3] ? Number(numeric[3]) : year, Number(numeric[2]) - 1, Number(numeric[1]));

  const monthPattern = Object.keys(MONTH_NUMBERS).join("|");
  const dayMonth = question.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${monthPattern})(?:\\s*,?\\s*(20\\d{2}))?\\b`, "i"));
  if (dayMonth) return isoDateForParts(dayMonth[3] ? Number(dayMonth[3]) : year, MONTH_NUMBERS[dayMonth[2].toLowerCase()], Number(dayMonth[1]));

  const monthDay = question.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(20\\d{2}))?\\b`, "i"));
  if (monthDay) return isoDateForParts(monthDay[3] ? Number(monthDay[3]) : year, MONTH_NUMBERS[monthDay[1].toLowerCase()], Number(monthDay[2]));

  return null;
}

export function startDateRequestFor(question: string, currentStartDate: string): StartDateRequestInterpretation | null {
  const text = question.trim();
  if (!/(start(?:ing)?(?: date)?|first day)/i.test(text)) return null;
  // Questions about the date, negated requests and requests about something other than the
  // start date ("set a reminder", "make sure the laptop...") are not change requests.
  if (/(what changes if|what if|would happen if|impact of)/i.test(text)) return null;
  if (/\b(don'?t|do not|never|not|why|who|did|has|have|was|were|reminder|due|make sure|update me)\b/i.test(text)) return null;
  if (!/\b(change|move|update|set|shift|reschedule|adjust|make|push|bring)\b/i.test(text)) return null;

  const date = requestedDateFrom(text, currentStartDate);
  if (!date) {
    return {
      kind: "clarify",
      message: "Which start date should I use? Include a date such as 19 October 2026. No change has been made.",
    };
  }
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return {
      kind: "clarify",
      message: `${formatDate(date)} is a ${weekday === 6 ? "Saturday" : "Sunday"}. Which working day should I use? No change has been made.`,
    };
  }
  return { kind: "confirm", date, label: formatDate(date) };
}

export function draftEditBlocksCaseMutation(editingEquipment: boolean, editingManager: boolean): boolean {
  return editingEquipment || editingManager;
}

export function committedJoinerSelection(currentJoinerId: string, loadedJoinerId?: string): string {
  return loadedJoinerId ?? currentJoinerId;
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

function localTimeParts(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: hour * 60 + minute,
    time: `${values.hour}:${values.minute}`,
  };
}

function minutesFromLocalTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function calendarDayLabel(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

const PX_PER_HALF_HOUR = 14;

function WeekStrip({
  assessment,
  startDate,
  request,
}: {
  assessment: BuddyCandidateAssessment;
  startDate: string;
  request: BuddyRequest | null;
}) {
  const { candidate, availability } = assessment;
  const dates = firstWorkingWeek(startDate);
  const timezone = availability.timezone ?? candidate.timezone;
  const workingHours = availability.working_hours ?? { start_local: "09:00", end_local: "17:30" };
  const workdayStart = minutesFromLocalTime(workingHours.start_local);
  const workdayEnd = minutesFromLocalTime(workingHours.end_local);
  const trackHeight = ((workdayEnd - workdayStart) / 30) * PX_PER_HALF_HOUR;
  const currentRequest = request
    && request.candidate_id === candidate.id
    && !["rejected", "superseded"].includes(request.status)
    ? request
    : null;
  const proposedSlots = currentRequest?.slots.length ? currentRequest.slots : availability.slots;
  const confirmed = currentRequest?.status === "confirmed";
  const busyIntervals = availability.busy_intervals ?? [];
  const isCalendarState = availability.status === "unknown" || availability.status === "error";
  const stateTitle = availability.status === "error" ? "Calendar read failed" : "Calendar not read for this candidate";

  const blocksForDate = (date: string) => {
    const busy = busyIntervals
      .map((interval) => ({
        key: `busy-${interval.start_at}`,
        label: "Busy",
        tone: "busy",
        start: localTimeParts(interval.start_at, timezone),
        end: localTimeParts(interval.end_at, timezone),
      }))
      .filter((block) => block.start.date === date);
    const slots = proposedSlots
      .map((slot) => ({
        key: slot.id,
        label: slot.kind,
        tone: confirmed ? "confirmed" : "proposed",
        start: localTimeParts(slot.start_at, timezone),
        end: localTimeParts(slot.end_at, timezone),
      }))
      .filter((block) => block.start.date === date);
    return [...busy, ...slots];
  };

  const blockStyle = (start: number, end: number): CSSProperties => ({
    top: `${Math.max(0, ((start - workdayStart) / 30) * PX_PER_HALF_HOUR)}px`,
    height: `${Math.max(PX_PER_HALF_HOUR, ((Math.min(end, workdayEnd) - Math.max(start, workdayStart)) / 30) * PX_PER_HALF_HOUR)}px`,
  });

  return (
    <div
      className="week-strip"
      role="group"
      aria-label={`First working week for ${candidate.full_name}, ${busyIntervals.length} busy blocks, ${proposedSlots.length} proposed slots`}
    >
      <div className="week-strip-head">
        <div>
          <strong>First working week</strong>
          <span>{workingHours.start_local} to {workingHours.end_local} · {timezone}</span>
        </div>
        <span className="sim-badge">Simulated calendar</span>
      </div>
      <div className={`week-calendar ${isCalendarState ? "state" : ""}`} style={{ "--week-track-height": `${trackHeight}px` } as CSSProperties}>
        <div className="week-time-axis" aria-hidden="true"><span>{workingHours.start_local}</span><span>{workingHours.end_local}</span></div>
        <div className="week-strip-grid">
          {dates.map((date, index) => {
            const blocks = isCalendarState ? [] : blocksForDate(date);
            return (
              <div className="week-day" key={date}>
                <strong className="week-day-head">
                  {calendarDayLabel(date)}
                  {!isCalendarState && index === 0 && <em className="week-arrival-note">arrives 09:30</em>}
                </strong>
                <div className="week-day-track">
                  {blocks.map((block) => (
                    <span
                      className={`week-block ${block.tone}`}
                      key={block.key}
                      style={blockStyle(block.start.minutes, block.end.minutes)}
                      title={`${block.label} ${block.start.time} to ${block.end.time}`}
                    >
                      <b>{block.label === "introduction" ? "Intro" : block.label === "shadowing" ? "Shadow" : block.label}</b><small>{block.start.time}</small>
                    </span>
                  ))}
                  {!isCalendarState && index === 0 && (
                    <span className="week-arrival" style={{ top: `${((570 - workdayStart) / 30) * PX_PER_HALF_HOUR}px` }} aria-hidden="true" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {isCalendarState && (
          <div className="week-calendar-note">
            <strong>{stateTitle}</strong>
            <span>{availability.reason}</span>
          </div>
        )}
      </div>
    </div>
  );
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
  if (status === "superseded") return "Request replaced";
  return "Allocation confirmed";
}

function activeBuddyRequest(request: Pick<BuddyRequest, "status"> | null) {
  return !!request && ["pending_approval", "awaiting_acceptance", "accepted", "confirmed"].includes(request.status);
}

type CandidateListAssessment = {
  candidate: { id: string };
  eligibility: { eligible: boolean };
  availability: { status: BuddyCandidateAssessment["availability"]["status"] };
};

export function candidateRequestTagFor(
  request: Pick<BuddyRequest, "status" | "candidate_id"> | null,
  candidateId: string,
) {
  if (!request || request.candidate_id !== candidateId) return null;
  if (request.status === "confirmed") return { label: "Confirmed", tone: "positive" as const };
  if (request.status === "accepted") return { label: "Awaiting confirmation", tone: "pending" as const };
  if (request.status === "awaiting_acceptance") return { label: "Awaiting response", tone: "pending" as const };
  if (request.status === "pending_approval") return { label: "Current request", tone: "info" as const };
  return null;
}

export function buddyCandidatesFor<T extends CandidateListAssessment>(
  candidates: T[],
  request: Pick<BuddyRequest, "status" | "candidate_id"> | null,
  recommendation: { candidate_id: string } | null,
) {
  const top = candidates.slice(0, 3);
  const currentRequestCandidate = activeBuddyRequest(request) ? request?.candidate_id : undefined;
  const requiredId = currentRequestCandidate ?? recommendation?.candidate_id;
  const base = !requiredId || top.some((assessment) => assessment.candidate.id === requiredId)
    ? top
    : (() => {
        const required = candidates.find((assessment) => assessment.candidate.id === requiredId);
        return required ? [...top.slice(0, 2), required] : top;
      })();
  const alternative = candidates.find((assessment) =>
    assessment.candidate.id !== requiredId
      && assessment.eligibility.eligible
      && assessment.availability.status === "available",
  );
  const visible = alternative && !base.some((assessment) => assessment.candidate.id === alternative.candidate.id)
    ? [...base, alternative]
    : base;
  return { candidates: visible, alternativeCandidateId: alternative?.candidate.id ?? null };
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
  if (run.screen_state === "awaiting_decision") return "Ready for your review";
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

export function equipmentMessageHistoryText(run: Pick<DemoResponse, "draft" | "screen_state" | "facts">): string {
  if (run.draft) return run.draft.body;
  if (run.screen_state === "draft_unavailable") return "Draft unavailable. Equipment risk remains. Run the assistant again before sending a message.";
  if (run.screen_state === "no_action" && !run.facts.equipment_late) return "No equipment message is needed.";
  return "No current equipment draft is available.";
}

export function BackgroundUpdateNotice({ hasUpdate, editingEquipment, editingManager }: { hasUpdate: boolean; editingEquipment: boolean; editingManager: boolean }) {
  if (!hasUpdate || (!editingEquipment && !editingManager)) return null;
  return <div className="background-update" role="status"><strong>New information arrived.</strong><span>Your unsaved wording is preserved. Save or cancel the edit before the workspace refreshes.</span></div>;
}

export function ApprovalEmptyState({ run }: { run: ApprovalPanelRun }) {
  if (run.screen_state === "draft_unavailable") {
    return (
      <div className="no-action-heading unavailable-heading">
        <p className="eyebrow">Model-proposed action</p>
        <h2>Draft unavailable. Equipment risk remains</h2>
        <p>The laptop is currently expected on {formatDate(run.facts.equipment_eta)}, after the {formatDate(run.facts.start_date)} start date. Run the assistant again before any message can be sent.</p>
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
          <h3>Initial onboarding checks completed</h3>
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

function AskEvidenceCard({ kind, snapshot, currentRun }: { kind: "equipment" | "buddy" | "timeline"; snapshot: DemoResponse; currentRun?: DemoResponse | null }) {
  const displayRun = currentRun ?? snapshot;
  if (kind === "equipment") {
    const draft = displayRun.draft;
    const riskRemains = displayRun.facts.equipment_late;
    return (
      <div className="ask-evidence-card" aria-label="Equipment evidence card">
        <div className="ask-card-head">
          <div><span className="eyebrow">Current evidence</span><strong>Equipment</strong></div>
          <Tag tone={riskRemains ? "attention" : "positive"}>{riskRemains ? "Risk remains" : "On track"}</Tag>
        </div>
        <div className="ask-card-grid">
          <div><span>ETA</span><strong>{formatDate(displayRun.facts.equipment_eta)}</strong></div>
          <div><span>Start date</span><strong>{formatDate(displayRun.facts.start_date)}</strong></div>
          <div><span>Owner</span><strong>{displayRun.facts.equipment_owner_name}</strong></div>
        </div>
        <p className="ask-card-note">{riskRemains ? "The equipment arrives after the current first day." : "The equipment arrives before the current first day."}</p>
        {draft && (
          <div className="ask-card-draft">
            <div className="ask-card-draft-head"><span>Current draft</span><Tag tone={draft.status === "pending" ? "pending" : draft.status === "approved" ? "positive" : "attention"}>{draft.status}</Tag></div>
            <strong>{draft.subject ?? "Equipment message"}</strong>
            <span>To {draft.recipient}</span>
            {draft.status === "pending" && <p>{draft.body}</p>}
          </div>
        )}
        {!draft && riskRemains && <div className="ask-card-draft unavailable"><strong>Draft unavailable</strong><span>Run the assistant again before any message can be sent.</span></div>}
      </div>
    );
  }

  if (kind === "buddy") {
    const request = displayRun.buddy.request;
    const recommendation = displayRun.buddy.availability.recommendation;
    const candidateIds = [
      request?.candidate_id,
      recommendation?.candidate_id,
      ...displayRun.buddy.availability.candidates.map((assessment) => assessment.candidate.id),
    ].filter((id): id is string => !!id);
    const candidates = [...new Set(candidateIds)]
      .map((id) => displayRun.buddy.availability.candidates.find((assessment) => assessment.candidate.id === id))
      .filter((assessment): assessment is BuddyCandidateAssessment => !!assessment)
      .slice(0, 3);
    return (
      <div className="ask-evidence-card" aria-label="Buddy comparison card">
        <div className="ask-card-head">
          <div><span className="eyebrow">Current evidence</span><strong>Buddy comparison</strong></div>
          <span className="sim-badge">Simulated calendar</span>
        </div>
        <div className="ask-card-candidates">
          {candidates.map((assessment) => {
            const isRecommendation = recommendation?.candidate_id === assessment.candidate.id;
            const isRequest = request?.candidate_id === assessment.candidate.id;
            return (
              <div className={`ask-card-candidate ${isRequest ? "current" : ""}`} key={assessment.candidate.id}>
                <div><strong>{assessment.candidate.full_name}</strong><span>{assessment.candidate.team} · {assessment.candidate.office}</span></div>
                <div><span className={`availability ${assessment.availability.status}`}>{availabilityLabel(assessment.availability.status)}</span><span>{assessment.candidate.active_buddies} of 2 active</span></div>
                <div className="ask-card-candidate-tags">
                  {isRecommendation && !isRequest && <Tag tone="violet">Recommended</Tag>}
                  {isRequest && <Tag tone={request?.status === "confirmed" ? "positive" : "pending"}>{requestLabel(request.status)}</Tag>}
                </div>
              </div>
            );
          })}
        </div>
        {request ? (
          <div className="ask-card-note"><strong>Request status:</strong> {requestLabel(request.status)} for {request.candidate_name}.</div>
        ) : (
          <div className="ask-card-note">{recommendation ? `Current recommendation: ${recommendation.candidate_name}.` : "No buddy is currently recommended from the available calendar snapshot."}</div>
        )}
        {displayRun.buddy.draft && (
          <div className="ask-card-draft">
            <div className="ask-card-draft-head"><span>Current buddy draft</span><Tag tone={displayRun.buddy.draft.status === "pending" ? "pending" : displayRun.buddy.draft.status === "approved" ? "positive" : "attention"}>{displayRun.buddy.draft.status}</Tag></div>
            <strong>{displayRun.buddy.draft.subject ?? "Buddy request"}</strong>
            <span>To {displayRun.buddy.draft.recipient}</span>
          </div>
        )}
      </div>
    );
  }

  const openTasks = displayRun.case.open_task_count ?? displayRun.case.task_count;
  return (
    <div className="ask-evidence-card" aria-label="Case timeline card">
      <div className="ask-card-head">
        <div><span className="eyebrow">Current evidence</span><strong>Case timeline</strong></div>
        <Tag tone="info">{displayRun.case.id}</Tag>
      </div>
      <div className="ask-card-grid">
        <div><span>Contract signed</span><strong>{formatDateTime(displayRun.facts.contract_signed_at)}</strong></div>
        <div><span>First day</span><strong>{formatDate(displayRun.facts.start_date)}</strong></div>
        <div><span>Open tasks</span><strong>{openTasks} of {displayRun.case.task_count}</strong></div>
      </div>
      <p className="ask-card-note">Current next action: {overallAttentionNextAction(displayRun)}</p>
    </div>
  );
}

function DateChangePrompt({
  request,
  currentRun,
  busy,
  blocked = false,
  onConfirm,
  onDismiss,
  preferredName = "Aisha",
}: {
  request: DateChangeRequest;
  currentRun: DemoResponse | null;
  busy: boolean;
  blocked?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  preferredName?: string;
}) {
  if (request.kind === "clarify") {
    return (
      <div className="ask-action-card" aria-label="Start date clarification">
        <div className="ask-card-head"><div><span className="eyebrow">Action needed</span><strong>Start date</strong></div><Tag tone="pending">Clarification</Tag></div>
        <p>{request.message}</p>
      </div>
    );
  }

  const alreadyCurrent = currentRun?.joiner.start_date === request.date;
  if (request.status === "confirmed") {
    return (
      <div className="ask-action-card" role="status" aria-label="Start date changed">
        <div className="ask-card-head"><div><span className="eyebrow">Case updated</span><strong>Start date changed to {request.label}</strong></div><Tag tone="positive">Reassessed</Tag></div>
        <p>Athena reassessed the current case evidence. Review the updated workspace before taking any approval action.</p>
      </div>
    );
  }
  if (request.status === "dismissed") {
    return (
      <div className="ask-action-card" role="status" aria-label="Start date unchanged">
        <div className="ask-card-head"><div><span className="eyebrow">No change made</span><strong>Current start date kept</strong></div><Tag tone="info">Unchanged</Tag></div>
        <p>No start-date change was made.</p>
      </div>
    );
  }

  return (
    <div className="ask-action-card" aria-label="Confirm start date change">
      <div className="ask-card-head"><div><span className="eyebrow">Confirmation required</span><strong>Change start date to {request.label}?</strong></div><Tag tone="pending">No change yet</Tag></div>
      <p>Athena interpreted your request as changing {preferredName}&apos;s first day to {request.label}. Confirming will reassess current evidence and invalidate stale work.</p>
      {alreadyCurrent && <p className="ask-card-note">That is already the current start date.</p>}
      <div className="ask-action-buttons">
        <button className="button primary small" type="button" onClick={onConfirm} disabled={busy || blocked || alreadyCurrent}>{busy ? "Recalculating..." : "Confirm start date change"}</button>
        <button className="button secondary small" type="button" onClick={onDismiss} disabled={busy || blocked}>Keep current date</button>
      </div>
      <span className="ask-hint">Chat text cannot change the case without this confirmation.</span>
    </div>
  );
}

const ASK_SUGGESTIONS = [
  "What's left before day one?",
  "Is the laptop sorted?",
  "Who is the buddy?",
  "Any compliance risk?",
];

const entryAskSuggestions = (preferredName: string) => [
  `Check ${preferredName}’s onboarding readiness.`,
  `Find an available buddy for ${preferredName}.`,
  `What changes if ${preferredName} starts on 19 October?`,
  `Check ${preferredName}’s access requests.`,
  `Open ${preferredName}’s profile.`,
  `Coordinate with ${preferredName}’s manager.`,
  "Answer new joiner questions.",
];

const ASK_LINK_LABELS: Record<AskLink, string> = {
  overview: "Back to conversation",
  equipment: "Open Equipment",
  buddy: "Open Buddy support",
  activity: "Open Activity",
};

export function AskAthenaPanel({
  history,
  question,
  compact,
  entry,
  busy,
  currentRun,
  dateChangeRequest,
  dateChangeBusy,
  onQuestionChange,
  onAsk,
  onNavigate,
  onConfirmDateChange,
  onDismissDateChange,
  onSwitchJoiner,
  blocked = false,
  children,
  joinerName = "Aisha Okafor",
  preferredName = "Aisha",
}: {
  blocked?: boolean;
  children?: React.ReactNode;
  joinerName?: string;
  preferredName?: string;
  history: AskHistoryItem[];
  question: string;
  compact?: boolean;
  entry?: boolean;
  busy: boolean;
  currentRun?: DemoResponse | null;
  dateChangeRequest?: DateChangeRequest | null;
  dateChangeBusy?: boolean;
  onQuestionChange: (value: string) => void;
  onAsk: (question: string) => void;
  onNavigate: (section: AskLink) => void;
  onConfirmDateChange?: () => void;
  onDismissDateChange?: () => void;
  onSwitchJoiner?: (joinerId: string) => void;
}) {
  const entrySuggestions = entryAskSuggestions(preferredName);
  const suggestions = entry ? entrySuggestions : ASK_SUGGESTIONS;
  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!busy && !blocked && trimmed) onAsk(trimmed);
  };

  const content = (
    <div className="ask-content">
      {busy && <div className="ask-processing" role="status" aria-live="polite">{entry ? `Opening ${preferredName}’s case and checking current evidence...` : "Reading current case evidence..."}</div>}
      {history.length === 0 ? (
        <p className="ask-empty">{entry ? `I’ll check what ${preferredName} needs, prepare the next steps, and bring you the decisions that need your approval.` : `I’ve checked ${preferredName}’s onboarding. Here’s what needs your attention.`}</p>
      ) : (
        <div className="ask-history" aria-live="polite">
          {history.slice(0, -1).length > 0 && <details className="earlier-conversation"><summary>Earlier conversation ({history.length - 1})</summary>{history.slice(0, -1).map((item) => <div key={item.id} className="earlier-exchange"><strong>{item.question}</strong><p>{item.answer.answer}</p></div>)}</details>}
          {history.slice(-1).map((item) => (
            <div className="ask-exchange" key={item.id}>
              <div className="ask-bubble ask-user"><span className="ask-bubble-label">You · People team</span><p>{item.question}</p></div>
              <div className="ask-assistant-row">
                <span className="ask-avatar" aria-hidden="true">A</span>
                <div className="ask-bubble ask-assistant">
                  <div className="ask-bubble-head"><strong>Athena</strong></div>
                  {!(dateChangeRequest?.history_id === item.id && (dateChangeRequest.kind === "clarify" || (dateChangeRequest.kind === "confirm" && dateChangeRequest.status === "pending"))) && <p>{item.question === entrySuggestions[0] && item.snapshot ? `${preferredName} starts on ${formatDate(item.snapshot.facts.start_date)}. ${item.snapshot.facts.equipment_late ? `The laptop is expected on ${formatDate(item.snapshot.facts.equipment_eta)}, after the first day.` : "The laptop is expected before day one."} ${item.snapshot.draft?.status === "pending" ? "I’ve prepared a message to IT for your review." : "The equipment status is shown below."} ${item.snapshot.buddy.request ? `There’s also a buddy request for ${item.snapshot.buddy.request.candidate_name}.` : "Buddy support still needs attention."}` : item.answer.answer}</p>}
                  {item.answer.switch_joiner_id && onSwitchJoiner && <button className="button secondary small" type="button" onClick={() => onSwitchJoiner(item.answer.switch_joiner_id!)}>Switch case</button>}
                  <details className="answer-evidence"><summary>Sources and answer details</summary><span className="meta">{item.answer.provider === "system" ? "Case scope check" : item.answer.provider === "anthropic" ? "Anthropic model" : "Mock answer"}</span>{item.question === entrySuggestions[0] && <p>{item.answer.answer}</p>}<div className="ask-facts"><span>Evidence used</span>{item.answer.facts.map((fact) => <span key={fact}>{fact}</span>)}</div>
                  {item.answer.card && <AskEvidenceCard kind={item.answer.card} snapshot={item.snapshot} currentRun={currentRun} />}
                  {item.answer.links.length > 0 && <div className="ask-links">{item.answer.links.map((link) => <button className="ask-link" type="button" key={link} onClick={() => onNavigate(link)}>{ASK_LINK_LABELS[link]}</button>)}</div>}</details>
                  {dateChangeRequest?.history_id === item.id && onConfirmDateChange && onDismissDateChange && (
                    <DateChangePrompt
                      request={dateChangeRequest}
                      currentRun={currentRun ?? null}
                      busy={dateChangeBusy ?? false}
                      blocked={blocked}
                      onConfirm={onConfirmDateChange}
                      onDismiss={onDismissDateChange}
                      preferredName={preferredName}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {children}
      <div className="ask-suggestions" aria-label="Suggested questions">
        {suggestions.map((suggestion) => <button className="ask-chip" type="button" key={suggestion} onClick={() => submit(suggestion)} disabled={busy || blocked}>{suggestion}{entry && <span aria-hidden="true">↗</span>}</button>)}
      </div>
      <form className="ask-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); submit(question); }}>
        <label htmlFor={compact ? "ask-question-drawer" : "ask-question"}>Ask Athena</label>
        <div className="ask-input-row">
          <textarea
            id={compact ? "ask-question-drawer" : "ask-question"}
            aria-label="Ask Athena question"
            rows={2}
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit(question);
              }
            }}
            placeholder={`Ask about ${preferredName}’s onboarding…`}
            maxLength={300}
            disabled={busy || blocked}
          />
          <button className="button primary small" type="submit" disabled={busy || blocked || !question.trim()}>{busy ? "Reading..." : "Ask"}</button>
        </div>
        <span className="ask-hint">Ask a question, or review the prepared messages below. Sending always needs your approval.</span>
      </form>
    </div>
  );

  if (compact) {
    return (
      <details className="ask-drawer" open={history.length > 0}>
        <summary><span><strong>Ask Athena</strong><span className="meta">{preferredName}’s onboarding</span></span><span className="meta">{history.length === 0 ? "Open" : `${history.length} asked`}</span></summary>
        {content}
      </details>
    );
  }

  return (
    <section className={`panel ask-panel ${entry ? "ask-entry-panel" : ""}`} aria-label="Ask Athena">
      <div className="panel-head">
        <div>
          <h3>Ask Athena</h3>
          {entry && <span className="meta ask-entry-subtitle">Let’s get {preferredName} ready for day one</span>}
        </div>
        <div className="ask-panel-meta">
          {entry && <Tag tone="info">Fictional demo</Tag>}
          <span className="meta">{entry ? "" : `${preferredName}’s onboarding`}</span>
        </div>
      </div>
      {entry && <div className="ask-scope" aria-label="Available demo scope"><span>This demo follows {joinerName}’s onboarding at Quilstead.</span></div>}
      {content}
    </section>
  );
}

const NAV: { key: Section; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "Conversation", icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8.5 8 3l6 5.5M4 7.5V13h8V7.5" /></svg> },
  { key: "equipment", label: "Equipment", icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3.5" width="12" height="8" rx="1" /><path d="M1.5 13h13" /></svg> },
  { key: "buddy", label: "Buddy support", icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="2.5" /><circle cx="11.5" cy="7" r="2" /><path d="M1.5 13.5c.6-2.3 2.3-3.5 4.5-3.5s3.9 1.2 4.5 3.5M10.5 10.6c1.9 0 3.3.9 4 2.9" /></svg> },
  { key: "activity", label: "Activity", icon: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8h3l2-4 3 8 2-4h2" /></svg> },
];

/* ---------- data access ---------- */

export class DemoRequestError extends Error {
  constructor(message: string, readonly status: number, readonly payload: DemoResponse & { error?: string }) {
    super(message);
    this.name = "DemoRequestError";
  }
}

export function equipmentApprovalRecovery(error: unknown, caseId: string): DemoResponse | null {
  if (!(error instanceof DemoRequestError) || error.status !== 409) return null;
  const payload = error.payload;
  if (payload.recovery !== "equipment_reassessment" || payload.case?.id !== caseId
    || payload.screen_state !== "draft_unavailable" || payload.draft !== null
    || typeof payload.run_id !== "string" || typeof payload.draft_unavailable?.message !== "string") return null;
  return payload;
}

export async function postDemo(body: Record<string, string> = {}) {
  const response = await fetch("/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as DemoResponse & { error?: string };
  if (!response.ok) {
    throw new DemoRequestError(payload.error ?? "The demo flow failed", response.status, payload);
  }
  return payload;
}

export async function getDemoSnapshot(): Promise<DemoSnapshotResponse> {
  const response = await fetch("/api/demo", { method: "GET", cache: "no-store" });
  const payload = await response.json() as DemoSnapshotResponse & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Monitoring status could not be refreshed");
  return payload;
}

export function backgroundCaseFor(cases: DemoResponse[], currentCaseId: string, selectedJoinerId: string): DemoResponse | null {
  return cases.find((candidate) => candidate.case.id === currentCaseId && candidate.joiner.id === selectedJoinerId) ?? null;
}

export function backgroundRefreshBlocked(editingEquipment: boolean, editingManager: boolean, mutationBusy: boolean): boolean {
  return editingEquipment || editingManager || mutationBusy;
}

export function monitorNotificationNavigationBlocked(mutationBusy: boolean, editingEquipment: boolean, editingManager: boolean): boolean {
  return mutationBusy || editingEquipment || editingManager;
}

const REVIEWED_ALERTS_KEY = "athena-reviewed-equipment-alerts";

export function monitorAlertKey(notification: MonitorNotification): string {
  return `${notification.id}:${notification.at}:${notification.draft_id ?? "cleared"}`;
}

export function currentMonitorAlerts(notifications: MonitorNotification[], cases: DemoResponse[], reviewed: string[]) {
  const latest = new Map<string, MonitorNotification>();
  for (const notification of notifications) latest.set(notification.case_id, notification);
  return [...latest.values()].reverse().flatMap((notification) => {
    const monitoredCase = backgroundCaseFor(cases, notification.case_id, notification.joiner_id);
    if (!monitoredCase || reviewed.includes(monitorAlertKey(notification))) return [];
    if (monitoredCase.facts.start_date !== notification.start_date || monitoredCase.facts.equipment_eta !== notification.equipment_eta) return [];
    if (notification.outcome === "proposal_prepared" && (!monitoredCase.facts.equipment_late
      || monitoredCase.draft?.id !== notification.draft_id || monitoredCase.draft.status !== "pending")) return [];
    if (notification.outcome === "risk_cleared" && monitoredCase.facts.equipment_late) return [];
    return [{ notification, monitoredCase }];
  });
}

export function managerEditRebase(current: DemoResponse, refreshed: DemoResponse | null): DemoResponse | null {
  if (!refreshed || refreshed.case.id !== current.case.id || refreshed.joiner.id !== current.joiner.id) return null;
  const currentRequest = current.manager_coordination.request;
  const currentDraft = current.manager_coordination.draft;
  const refreshedRequest = refreshed.manager_coordination.request;
  const refreshedDraft = refreshed.manager_coordination.draft;
  if (!currentRequest || !currentDraft || !refreshedRequest || !refreshedDraft) return null;
  if (currentRequest.id !== refreshedRequest.id || refreshedRequest.status !== "pending_approval") return null;
  if (currentDraft.id !== refreshedDraft.id || refreshedDraft.status !== "pending") return null;
  return refreshed;
}

export function monitorStatusLabel(state: MonitorCaseSnapshot["state"] | null): string {
  if (state === "checking") return "Checking a change";
  if (state === "needs_attention") return "Needs attention";
  if (state === "paused") return "Paused";
  return "Watching equipment updates";
}

export function monitorNotificationText(notification: MonitorNotification, monitoredCase: DemoResponse): string {
  const name = monitoredCase.joiner.full_name;
  const eta = formatDate(notification.equipment_eta);
  const start = formatDate(notification.start_date);
  return notification.outcome === "proposal_prepared"
    ? `${name}'s laptop is now expected on ${eta}, after the ${start} start date. I've prepared a request for a loaner or earlier delivery.`
    : `${name}'s laptop is now expected on ${eta}, before the ${start} start date. No equipment message is needed.`;
}

const DEMO_JOINERS = [
  { id: "J-004", full_name: "Aisha Okafor", preferred_name: "Aisha", title: "Customer Success Manager", start_date: "2026-10-12" },
  { id: "J-001", full_name: "Priya Raman", preferred_name: "Priya", title: "Senior Software Engineer", start_date: "2026-10-05" },
] as const;

/* ---------- page ---------- */

export default function Home() {
  const [run, setRun] = useState<DemoResponse | null>(null);
  const [selectedJoinerId, setSelectedJoinerId] = useState<string>("J-004");
  const [caseUiCache, setCaseUiCache] = useState<Record<string, { history: AskHistoryItem[]; initial: ExecutionSummaryRun | null }>>({});
  const [initialExecution, setInitialExecution] = useState<ExecutionSummaryRun | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [workFocus, setWorkFocus] = useState<WorkFocus>("all");
  const [dateDraft, setDateDraft] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "switch" | "reset" | "date" | "retry" | "edit" | "supplier" | "manager_prepare" | "manager_edit" | "manager_approve" | "manager_reject" | "manager_response" | "manager_confirm" | "ask" | "access" | "availability" | "buddy_prepare" | "buddy_approve" | "buddy_reject" | "buddy_accept" | "buddy_decline" | "buddy_confirm" | DemoDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingEquipment, setEditingEquipment] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editingManager, setEditingManager] = useState(false);
  const [managerEditSubject, setManagerEditSubject] = useState("");
  const [managerEditBody, setManagerEditBody] = useState("");
  const [askHistory, setAskHistory] = useState<AskHistoryItem[]>([]);
  const [askQuestion, setAskQuestion] = useState("");
  const [dateChangeRequest, setDateChangeRequest] = useState<DateChangeRequest | null>(null);
  const [monitorSnapshot, setMonitorSnapshot] = useState<MonitorSnapshot | null>(null);
  const [snapshotCases, setSnapshotCases] = useState<DemoResponse[]>([]);
  const [reviewedAlerts, setReviewedAlerts] = useState<string[]>(() => {
    // No alerts render during SSR: the case opens after a user action.
    if (typeof window === "undefined") return [];
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(REVIEWED_ALERTS_KEY) ?? "[]");
      return Array.isArray(saved) && saved.every((key) => typeof key === "string") ? saved : [];
    } catch (error) {
      console.warn("Previously dismissed Athena alerts could not be restored from this browser.", error);
      return [];
    }
  });
  const [backgroundUpdate, setBackgroundUpdate] = useState<DemoResponse | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [pendingSupplierEta, setPendingSupplierEta] = useState<string | null>(null);
  const draftEditBlocksMutations = draftEditBlocksCaseMutation(editingEquipment, editingManager);

  function dismissMonitorAlert(notification: MonitorNotification) {
    const next = [...new Set([...reviewedAlerts, monitorAlertKey(notification)])];
    setReviewedAlerts(next);
    try { localStorage.setItem(REVIEWED_ALERTS_KEY, JSON.stringify(next)); }
    catch { setError("The alert is hidden for this page, but this browser could not remember its dismissal."); }
  }

  async function reviewMonitorAlert(notification: MonitorNotification) {
    if (busy !== null || draftEditBlocksMutations) return;
    if (run?.case.id !== notification.case_id && !await switchJoiner(notification.joiner_id)) return;
    setWorkFocus("equipment");
    setSection("equipment");
    dismissMonitorAlert(notification);
  }

  function acceptRun(next: DemoResponse, replaceInitial = false) {
    setRun(next);
    setBackgroundUpdate(null);
    setInitialExecution((current) => initialExecutionFor(current, next, replaceInitial));
    setDateDraft(next.joiner.start_date);
    setSelectedCandidateId(activeBuddyRequest(next.buddy.request)
      ? next.buddy.request?.candidate_id ?? null
      : next.buddy.availability.recommendation?.candidate_id ?? null);
  }

  useEffect(() => {
    const currentCaseId = run?.case.id;
    if (!currentCaseId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (disposed || document.visibilityState !== "visible") return;
      timer = setTimeout(() => { void poll(); }, 3_000);
    };
    const poll = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      try {
        const snapshot = await getDemoSnapshot();
        if (disposed) return;
        setMonitorSnapshot(snapshot.monitor);
        setSnapshotCases(snapshot.cases);
        setMonitorError(null);
        const current = run;
        if (!current) return;
        const latest = backgroundCaseFor(snapshot.cases, current.case.id, current.joiner.id);
        if (!latest || latest.run_id === current.run_id) {
          setBackgroundUpdate(null);
          return;
        }
        // Foreground mutations publish their own result. Do not retain their
        // intermediate snapshots as though they were unsaved editor updates.
        if (busy !== null) return;
        if (backgroundRefreshBlocked(editingEquipment, editingManager, busy !== null)) {
          setBackgroundUpdate(latest);
          return;
        }
        setRun(latest);
        setInitialExecution((initial) => initialExecutionFor(initial, latest, false));
        setDateDraft(latest.joiner.start_date);
        setSelectedCandidateId(activeBuddyRequest(latest.buddy.request)
          ? latest.buddy.request?.candidate_id ?? null
          : latest.buddy.availability.recommendation?.candidate_id ?? null);
        setBackgroundUpdate(null);
      } catch (caught) {
        if (!disposed) setMonitorError(caught instanceof Error ? caught.message : "Monitoring status could not be refreshed");
      } finally {
        schedule();
      }
    };
    const resumeOnFocus = () => {
      if (document.visibilityState !== "visible") {
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = null;
      void poll();
    };

    void poll();
    document.addEventListener("visibilitychange", resumeOnFocus);
    window.addEventListener("focus", resumeOnFocus);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", resumeOnFocus);
      window.removeEventListener("focus", resumeOnFocus);
    };
  }, [run, editingEquipment, editingManager, busy]);

  function caseBody(current: DemoResponse, body: Record<string, string> = {}) {
    return { case_id: current.case.id, run_id: current.run_id, ...body };
  }

  async function switchJoiner(joinerId: string) {
    if (joinerId === selectedJoinerId && run?.joiner.id === joinerId) return;
    if (draftEditBlocksMutations) {
      setError("Save or cancel your draft edits before switching joiners.");
      return;
    }
    if (!DEMO_JOINERS.some((joiner) => joiner.id === joinerId)) return;
    if (run) {
      setCaseUiCache((current) => ({
        ...current,
        [run.joiner.id]: { history: askHistory, initial: initialExecution },
      }));
    }
    setBusy("switch");
    setError(null);
    try {
      const next = await postDemo({ action: "open_case", joiner_id: joinerId });
      const cached = caseUiCache[joinerId];
      setSelectedJoinerId(committedJoinerSelection(selectedJoinerId, next.joiner.id));
      setRun(next);
      setInitialExecution(cached?.initial ?? next);
      setAskHistory(cached?.history ?? []);
      setDateDraft(next.joiner.start_date);
      setSelectedCandidateId(activeBuddyRequest(next.buddy.request)
        ? next.buddy.request?.candidate_id ?? null
        : next.buddy.availability.recommendation?.candidate_id ?? null);
      setEditingEquipment(false);
      setEditingManager(false);
      setBackgroundUpdate(null);
      setPendingSupplierEta(null);
      setAskQuestion("");
      setDateChangeRequest(null);
      setWorkFocus("all");
      setSection("overview");
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The joiner could not be opened");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function startFlow() {
    if (draftEditBlocksMutations) {
      setError("Save or cancel your draft edits first.");
      return;
    }
    if (run) return;
    setBusy("start");
    setError(null);
    try {
      const next = await postDemo({ joiner_id: selectedJoinerId });
      acceptRun(next, true);
      setEditingEquipment(false);
      setEditingManager(false);
      setAskHistory([]);
      setWorkFocus("all");
      setAskQuestion("");
      setDateChangeRequest(null);
      setSection("overview");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The demo flow failed");
    } finally {
      setBusy(null);
    }
  }

  async function resetFlow() {
    if (draftEditBlocksMutations) {
      setError("Save or cancel your draft edits first.");
      return;
    }
    setBusy("reset");
    setError(null);
    try {
      await postDemo({ action: "reset" });
      setRun(null);
      setSelectedJoinerId("J-004");
      setCaseUiCache({});
      setInitialExecution(null);
      setDateDraft("");
      setSelectedCandidateId(null);
      setEditingEquipment(false);
      setEditingManager(false);
      setAskHistory([]);
      setWorkFocus("all");
      setAskQuestion("");
      setDateChangeRequest(null);
      setMonitorSnapshot(null);
      setSnapshotCases([]);
      setBackgroundUpdate(null);
      setMonitorError(null);
      setPendingSupplierEta(null);
      setSection("overview");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The demo reset failed");
    } finally {
      setBusy(null);
    }
  }

  async function decide(decision: DemoDecision) {
    if (editingEquipment || editingManager || !run || !run.draft || run.screen_state !== "awaiting_decision") return;
    setBusy(decision);
    setError(null);
    try {
      acceptRun(await postDemo(caseBody(run, { decision })));
    } catch (caught) {
      const recovery = equipmentApprovalRecovery(caught, run.case.id);
      if (recovery) acceptRun(recovery);
      setError(caught instanceof Error ? caught.message : "The approval action failed");
    } finally {
      setBusy(null);
    }
  }

  async function askAthena(question = askQuestion) {
    if (draftEditBlocksMutations) {
      setError("Save or cancel your draft edits first.");
      return;
    }
    const trimmed = question.trim();
    if (!trimmed || trimmed.length > 300) return;
    const openingCase = run === null;
    const historyId = `ask-${Date.now()}-${askHistory.length}`;
    setBusy("ask");
    setError(null);
    try {
      const next = await postDemo(openingCase
        ? { action: "ask", question: trimmed, joiner_id: selectedJoinerId }
        : caseBody(run, { action: "ask", question: trimmed }));
      if (!next.answer) throw new Error("Ask Athena returned no answer.");
      acceptRun(next, openingCase);
      const nextFocus = next.answer.clarification ? "answer" : workFocusFor(trimmed, next.answer.card);
      setSection(nextFocus === "profile" ? "profile" : "overview");
      setWorkFocus(nextFocus);
      setAskHistory((current) => [...current, { id: historyId, question: trimmed, answer: next.answer!, snapshot: next }]);
      if (next.answer.clarification) setDateChangeRequest(null);
      const dateInterpretation = next.answer.clarification ? null : startDateRequestFor(trimmed, next.joiner.start_date);
      if (dateInterpretation?.kind === "confirm") {
        setDateChangeRequest({ kind: "confirm", history_id: historyId, date: dateInterpretation.date!, label: dateInterpretation.label!, status: "pending" });
      } else if (dateInterpretation?.kind === "clarify") {
        setDateChangeRequest({ kind: "clarify", history_id: historyId, message: dateInterpretation.message ?? "Please provide the intended start date. No change has been made." });
      }
      setAskQuestion("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ask Athena could not read the case");
    } finally {
      setBusy(null);
    }
  }

  async function confirmStartDateRequest() {
    if (draftEditBlocksMutations) {
      setError("Save or cancel your draft edits first.");
      return;
    }
    if (busy !== null) return;
    const request = dateChangeRequest;
    // Same rule as the header date control: the case stays mutable until the run phase resolves,
    // regardless of whether the equipment draft has been decided.
    if (request?.kind !== "confirm" || request.status !== "pending" || !run || run.phase === "resolved") return;
    if (request.date === run.joiner.start_date) {
      setDateChangeRequest({ ...request, status: "dismissed" });
      return;
    }
    setBusy("date");
    setError(null);
    try {
      const next = await postDemo(caseBody(run, { action: "start_date_change", start_date: request.date }));
      acceptRun(next);
      setDateChangeRequest({ ...request, status: "confirmed" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The start-date change failed");
    } finally {
      setBusy(null);
    }
  }

  function dismissStartDateRequest() {
    if (!dateChangeRequest) return;
    if (dateChangeRequest.kind === "confirm") setDateChangeRequest({ ...dateChangeRequest, status: "dismissed" });
    else setDateChangeRequest(null);
  }

  async function changeStartDate() {
    if (editingEquipment || editingManager) {
      setError("Save or cancel your draft edits first.");
      return;
    }
    if (!run || !dateDraft || run.phase !== "pending" || dateDraft === run.joiner.start_date) return;
    setBusy("date");
    setError(null);
    setDateChangeRequest(null);
    try {
      acceptRun(await postDemo(caseBody(run, { action: "start_date_change", start_date: dateDraft })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The start-date change failed");
    } finally {
      setBusy(null);
    }
  }

  async function runAssistantAgain() {
    if (editingEquipment || editingManager || !run || run.screen_state !== "draft_unavailable") return;
    setBusy("retry");
    setError(null);
    try {
      acceptRun(await postDemo(caseBody(run, { action: "retry_agent" })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The assistant retry failed");
    } finally {
      setBusy(null);
    }
  }

  async function simulateSupplierUpdate() {
    if (editingEquipment || editingManager || !run || run.joiner.id !== "J-001" || supplierUpdateWaiting) return;
    const restoring = run.facts.equipment_eta === "2026-10-09";
    const eta = restoring ? "2026-10-02" : "2026-10-09";
    setBusy("supplier");
    setError(null);
    try {
      const response = await postDemo(caseBody(run, {
        action: "equipment_supplier_update",
        eta,
        status: restoring ? "ordered" : "backordered",
      }));
      setPendingSupplierEta(response.source_update?.data?.eta ?? eta);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The simulated supplier update failed");
    } finally {
      setBusy(null);
    }
  }

  async function prepareBuddy(candidateId: string) {
    if (editingEquipment || editingManager || !run) return;
    setSelectedCandidateId(candidateId);
    setBusy("buddy_prepare");
    setError(null);
    try {
      acceptRun(await postDemo(caseBody(run, { action: "buddy_prepare", candidate_id: candidateId })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The buddy request could not be prepared");
    } finally {
      setBusy(null);
    }
  }

  async function requestAccess() {
    if (editingEquipment || editingManager || !run) return;
    setBusy("access");
    setError(null);
    try {
      acceptRun(await postDemo(caseBody(run, { action: "access_request" })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The access requests could not be submitted");
    } finally {
      setBusy(null);
    }
  }

  async function prepareManager() {
    if (editingEquipment || editingManager || !run) return;
    setBusy("manager_prepare");
    setError(null);
    try {
      acceptRun(await postDemo(caseBody(run, { action: "manager_prepare" })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The manager request could not be prepared");
    } finally {
      setBusy(null);
    }
  }

  function beginManagerEdit() {
    const draft = run?.manager_coordination.draft;
    if (!draft || draft.status !== "pending") return;
    setManagerEditSubject(draft.subject ?? "");
    setManagerEditBody(draft.body);
    setEditingManager(true);
    setError(null);
  }

  function cancelManagerEdit() {
    setEditingManager(false);
    setError(null);
  }

  async function saveManagerEdit() {
    const request = run?.manager_coordination.request;
    const draft = run?.manager_coordination.draft;
    if (!run || !request || !draft || draft.status !== "pending") return;
    setBusy("manager_edit");
    setError(null);
    try {
      const visibleRun = run;
      const retainedRefresh = managerEditRebase(visibleRun, backgroundUpdate);
      let editBase = retainedRefresh ?? visibleRun;
      const editBody = {
        action: "manager_edit",
        request_id: request.id,
        draft_id: draft.id,
        subject: managerEditSubject,
        body: managerEditBody,
      };
      let saved: DemoResponse;
      try {
        saved = await postDemo(caseBody(editBase, editBody));
      } catch (caught) {
        if (!(caught instanceof DemoRequestError) || caught.status !== 409) throw caught;
        const snapshot = await getDemoSnapshot();
        setMonitorSnapshot(snapshot.monitor);
        setSnapshotCases(snapshot.cases);
        const latest = backgroundCaseFor(snapshot.cases, visibleRun.case.id, visibleRun.joiner.id);
        const retryBase = managerEditRebase(visibleRun, latest);
        if (!retryBase || retryBase.run_id === editBase.run_id) {
          if (latest) setBackgroundUpdate(latest);
          throw new Error("The manager request changed while you were editing. Your wording is preserved. Cancel to review the current request.");
        }
        editBase = retryBase;
        saved = await postDemo(caseBody(editBase, editBody));
      }
      acceptRun(saved);
      setEditingManager(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The manager draft could not be saved");
    } finally {
      setBusy(null);
    }
  }

  async function decideManager(decision: DemoDecision) {
    const request = run?.manager_coordination.request;
    const draft = run?.manager_coordination.draft;
    if (!run || !request || !draft || !["pending_approval", "send_failed"].includes(request.status)) return;
    setBusy(decision === "approve" ? "manager_approve" : "manager_reject");
    setError(null);
    try {
      acceptRun(await postDemo(caseBody(run, { action: "manager_decision", request_id: request.id, draft_id: draft.id, decision })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The manager approval could not be recorded");
    } finally {
      setBusy(null);
    }
  }

  async function simulateManagerReply() {
    const request = run?.manager_coordination.request;
    if (!run || !request || request.status !== "awaiting_response") return;
    setBusy("manager_response");
    setError(null);
    try {
      acceptRun(await postDemo(caseBody(run, { action: "manager_response", request_id: request.id })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The simulated manager response failed");
    } finally {
      setBusy(null);
    }
  }

  async function confirmManager() {
    const request = run?.manager_coordination.request;
    if (!run || !request || request.status !== "responded") return;
    setBusy("manager_confirm");
    setError(null);
    try {
      acceptRun(await postDemo(caseBody(run, { action: "manager_confirm", request_id: request.id })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The manager plan could not be confirmed");
    } finally {
      setBusy(null);
    }
  }

  async function simulateAvailability(candidateId: string) {
    if (editingEquipment || editingManager || !run) return;
    setBusy("availability");
    setError(null);
    try {
      acceptRun(await postDemo(caseBody(run, { action: "buddy_availability_change", candidate_id: candidateId })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The simulated availability change failed");
    } finally {
      setBusy(null);
    }
  }

  async function decideBuddy(decision: DemoDecision) {
    if (editingEquipment || editingManager || !run || !run.buddy.request || !run.buddy.draft || run.buddy.request.status !== "pending_approval") return;
    setBusy(decision === "approve" ? "buddy_approve" : "buddy_reject");
    setError(null);
    try {
      acceptRun(await postDemo(caseBody(run, {
        action: "buddy_decision",
        request_id: run.buddy.request.id,
        draft_id: run.buddy.draft.id,
        decision,
      })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The buddy approval action failed");
    } finally {
      setBusy(null);
    }
  }

  async function simulateBuddyResponse(response: "accepted" | "declined") {
    if (editingEquipment || editingManager || !run || !run.buddy.request || run.buddy.request.status !== "awaiting_acceptance") return;
    setBusy(response === "accepted" ? "buddy_accept" : "buddy_decline");
    setError(null);
    try {
      acceptRun(await postDemo(caseBody(run, { action: "buddy_response", request_id: run.buddy.request.id, response })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The simulated buddy response failed");
    } finally {
      setBusy(null);
    }
  }

  async function confirmBuddyAllocation() {
    if (editingEquipment || editingManager || !run || !run.buddy.request || run.buddy.request.status !== "accepted") return;
    setBusy("buddy_confirm");
    setError(null);
    try {
      acceptRun(await postDemo(caseBody(run, { action: "buddy_confirm", request_id: run.buddy.request.id })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The buddy confirmation failed");
    } finally {
      setBusy(null);
    }
  }

  function beginEquipmentEdit() {
    if (editingManager || !run?.draft || run.screen_state !== "awaiting_decision" || run.draft.status !== "pending") return;
    setEditSubject(run.draft.subject ?? "");
    setEditBody(run.draft.body);
    setError(null);
    setEditingEquipment(true);
  }

  function cancelEquipmentEdit() {
    setEditingEquipment(false);
    setError(null);
  }

  async function saveEquipmentEdit() {
    if (!run?.draft || run.screen_state !== "awaiting_decision" || run.draft.status !== "pending") return;
    setBusy("edit");
    setError(null);
    try {
      const next = await postDemo(caseBody(run, {
        action: "edit_equipment_draft",
        draft_id: run.draft.id,
        subject: editSubject,
        body: editBody,
      }));
      acceptRun(next);
      setEditingEquipment(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The draft edit could not be saved");
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
  const candidateView = run
    ? buddyCandidatesFor(run.buddy.availability.candidates, buddyRequest, recommendedBuddy ?? null)
    : { candidates: [], alternativeCandidateId: null };
  const buddyCandidates = candidateView.candidates;
  const alternativeCandidateId = candidateView.alternativeCandidateId;
  const simulationCandidate = run?.buddy.availability.candidates.find((assessment) => assessment.candidate.id === simulationTarget && assessment.availability.status === "available");
  const selectedAssessment = run?.buddy.availability.candidates.find((assessment) => assessment.candidate.id === selectedCandidateId) ?? null;
  const timelineItems = run ? [
    { key: "contract", at: run.facts.contract_signed_at, date: formatDateTime(run.facts.contract_signed_at), title: "Contract signed", detail: `${run.facts.contract_event_id} received`, tone: "" },
    { key: "equipment-task", at: run.facts.equipment_task_due_at, date: `Due ${formatDateTime(run.facts.equipment_task_due_at)}`, title: run.facts.equipment_task_title, detail: `Owner: ${run.facts.equipment_owner_name}`, tone: "" },
    { key: "start", at: `${run.facts.start_date}T00:00:00Z`, date: formatDate(run.facts.start_date), title: "First day", detail: `${run.joiner.office} / ${run.joiner.work_mode}`, tone: "" },
    { key: "delivery", at: `${run.facts.equipment_eta}T00:00:00Z`, date: `ETA ${formatDate(run.facts.equipment_eta)}`, title: "Equipment delivery", detail: `${gapLabel(run.facts.gap_days)} / ${run.facts.equipment_owner_name}`, tone: run.facts.equipment_late ? "risk" : "cleared" },
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at)) : [];
  const openAttention = run ? [run.attention.equipment, run.attention.buddy, run.attention.compliance].filter((item) => attentionTone(item.status) !== "positive").length : 0;
  const selectedJoiner = DEMO_JOINERS.find((joiner) => joiner.id === selectedJoinerId) ?? DEMO_JOINERS[0];
  const currentJoinerName = run?.joiner.full_name ?? selectedJoiner.full_name;
  const currentPreferredName = currentJoinerName.split(" ")[0];
  const supplierUpdateWaiting = pendingSupplierEta !== null && run?.facts.equipment_eta !== pendingSupplierEta;
  const currentMonitor = run ? monitorSnapshot?.cases.find((candidate) => candidate.case_id === run.case.id) ?? null : null;
  const monitorNotifications = currentMonitorAlerts(monitorSnapshot?.notifications ?? [], snapshotCases, reviewedAlerts);

  const renderAskAthena = (compact = false, entry = false) => (
    <AskAthenaPanel
      history={askHistory}
      question={askQuestion}
      compact={compact}
      entry={entry}
      busy={busy === "ask"}
      blocked={busy !== null || draftEditBlocksMutations}
      currentRun={run}
      dateChangeRequest={dateChangeRequest}
      dateChangeBusy={busy === "date"}
      onQuestionChange={setAskQuestion}
      onAsk={askAthena}
      onNavigate={setSection}
      onConfirmDateChange={confirmStartDateRequest}
      onDismissDateChange={dismissStartDateRequest}
      onSwitchJoiner={switchJoiner}
      joinerName={currentJoinerName}
      preferredName={currentPreferredName}
    >
      {!entry && run && renderPreparedWork(run)}
    </AskAthenaPanel>
  );

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

  function renderPreparedWork(current: DemoResponse) {
    const request = current.buddy.request;
    const show = (topic: WorkFocus) => workFocus === "all" || workFocus === topic;
    const preferredName = current.joiner.full_name.split(" ")[0];
    return (
      <section className="conversation-actions" aria-label="Prepared work">
        <nav className="work-focus" aria-label="Workstream view">{(["all", "equipment", "buddy", "compliance", "dates", "access", "profile", "manager", "joiner"] as const).map((topic) => <button type="button" key={topic} aria-pressed={workFocus === topic} disabled={busy !== null || editingEquipment || editingManager} onClick={() => { setWorkFocus(topic); setSection(topic === "profile" ? "profile" : "overview"); }}>{topic === "all" ? "All readiness" : FOCUS_LABELS[topic]}</button>)}</nav>
        <div className="prepared-heading"><h2>{workFocus === "all" ? "The day-one picture" : workFocus === "answer" ? `Explore ${preferredName}’s onboarding` : FOCUS_LABELS[workFocus]}</h2><p>{workFocus === "all" ? `Every part of ${preferredName}’s onboarding, with owners and next steps.` : workFocus === "dates" ? "Explore a new start date above. Changes need your confirmation." : workFocus === "answer" ? "Choose a workstream to see its current actions." : "Current progress and the next decision for this workstream."}</p></div>
        {show("dates") && current.date_change && <p className="conversation-update" role="status">{preferredName} now starts on {formatDate(current.facts.start_date)}. I’ve checked the plan again.</p>}
        {workFocus === "dates" && <section className="date-focus-card" aria-label="Start date overview"><span className="date-tile"><strong>{new Date(current.facts.start_date + "T00:00:00Z").getUTCDate()}</strong><span>{new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(current.facts.start_date + "T00:00:00Z"))}</span></span><div><h3>Current first day</h3><p>{formatDate(current.facts.start_date)}</p><p>Equipment timing, buddy availability and task deadlines are checked again when the date changes.</p></div></section>}
        {show("equipment") && <div className="workstream equipment-work" data-workstream="equipment">{current.draft?.status === "pending" || current.screen_state === "draft_unavailable" ? renderEquipmentApproval(current) : (
          <div className="work-receipt" role="status"><span aria-hidden="true">{current.decision === "approve" || !current.facts.equipment_late ? "✓" : "!"}</span><div><strong>{current.decision === "approve" ? "Request sent to " + current.facts.equipment_owner_name : !current.facts.equipment_late ? "Laptop expected before day one" : "Equipment still needs attention"}</strong><p>{current.attention.equipment.next_action}</p><button className="ask-link" onClick={() => setSection("equipment")}>View equipment details</button></div></div>
        )}</div>}
        {show("buddy") && <div className="workstream buddy-work" data-workstream="buddy">{request ? renderBuddyRequest(current) : (
          <div className="work-receipt"><span aria-hidden="true">!</span><div><strong>Buddy support needs attention</strong><p>{current.attention.buddy.next_action}</p><button className="ask-link" onClick={() => setSection("buddy")}>Review available buddies</button></div></div>
        )}</div>}
        {show("compliance") && <div className="workstream compliance-work" data-workstream="compliance"><div className="work-receipt"><span aria-hidden="true">{current.attention.compliance.open_tasks > 0 ? "!" : "✓"}</span><div><strong>{current.attention.compliance.open_tasks > 0 ? "Required checks still outstanding" : "Required checks complete"}</strong><p>{current.attention.compliance.next_action}</p><span className="meta">{current.attention.compliance.owner_name} is responsible for this check.</span></div></div></div>}

        {current.onboarding && (["access", "profile", "manager", "joiner"] as const).filter(show).map((kind) => <OnboardingScenario
          key={kind}
          kind={kind}
          view={current.onboarding!}
          compact={workFocus === "all"}
          disabled={busy !== null || editingEquipment || editingManager}
          managerEditDisabled={busy !== null}
          onAsk={askAthena}
          onRequestAccess={requestAccess}
          managerCoordination={current.manager_coordination}
          editingManager={editingManager}
          managerEditSubject={managerEditSubject}
          managerEditBody={managerEditBody}
          onPrepareManager={prepareManager}
          onBeginManagerEdit={beginManagerEdit}
          onManagerEditSubject={setManagerEditSubject}
          onManagerEditBody={setManagerEditBody}
          onSaveManagerEdit={saveManagerEdit}
          onCancelManagerEdit={cancelManagerEdit}
          onManagerDecision={decideManager}
          onSimulateManagerResponse={simulateManagerReply}
          onConfirmManager={confirmManager}
          onOpen={(topic) => { setWorkFocus(topic); setSection(topic === "profile" ? "profile" : "overview"); }}
        />)}
        {workFocus === "all" && current.onboarding && <details className="disclosure"><summary>All {current.onboarding.tasks.length} onboarding tasks</summary><div className="disclosure-body"><OnboardingTasks tasks={current.onboarding.tasks} /></div></details>}

      </section>
    );
  }

  /* ---------- sections ---------- */

  function renderCaseDetails(current: DemoResponse) {
    const nextAction = agentNextAction(current, overallAttentionNextAction(current));
    const rows = [
      { key: "equipment" as Section, label: "Equipment", data: current.attention.equipment, detail: current.facts.equipment_late ? `ETA ${formatDate(current.facts.equipment_eta)}, start ${formatDate(current.facts.start_date)}` : `ETA ${formatDate(current.facts.equipment_eta)} before start` },
      { key: "buddy" as Section, label: "Buddy support", data: current.attention.buddy, detail: current.attention.buddy.candidate_name ?? "No candidate selected" },
    ];
    const compliance = current.attention.compliance;
    return (
      <div className="overview-layout">
        <div className="overview-main">
        <ExecutionSummary run={initialExecution ?? current} />
        {current.agent && <div className="agent-run-line" role="status"><strong>Assistant</strong><span>{current.agent.trigger.replaceAll("_", " ")} · {current.agent.steps} model steps · {current.agent.proposed} proposals · {current.agent.refused} refused</span><span>{current.agent.stop_reason === "finished" ? "Finished" : `Stopped: ${current.agent.stop_reason}`}</span></div>}
        <div className="next-action"><strong>Next:</strong> {nextAction}</div>
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
        </div>

      </div>
    );
  }

  function renderEquipmentApproval(current: DemoResponse) {
    return (
          <section className="panel" aria-label="Approval">
            <div className="panel-head"><h3>Message to {current.facts.equipment_owner_name}</h3><Tag tone={decisionTone(current)}>{decisionLabel(current)}</Tag></div>
            <div className="panel-body stack">
              {current.draft ? (
                <>
                  <div className="draft-meta">
                    <div><span>To</span><strong>{current.draft.recipient}</strong></div>
                    <div><span>Channel</span><strong>{current.draft.channel}</strong></div>
                    {!editingEquipment && <div><span>Subject</span><strong>{current.draft.subject}</strong></div>}
                    <details className="wording-details"><summary>About this draft</summary><div className="draft-tags"><Tag tone="violet">{modelLabel(current.model.provider)}</Tag>{current.draft.edited_by && <Tag tone="info">Edited by People</Tag>}</div></details>
                  </div>
                  {editingEquipment ? (
                    <div className="draft-editor">
                      <label>
                        <span>Subject</span>
                        <input aria-label="Draft subject" value={editSubject} onChange={(event) => setEditSubject(event.target.value)} disabled={busy !== null} />
                      </label>
                      <label>
                        <span>Message</span>
                        <textarea aria-label="Draft message" rows={7} value={editBody} onChange={(event) => setEditBody(event.target.value)} disabled={busy !== null} />
                      </label>
                    </div>
                  ) : (
                    <div className="message">
                      <div className="message-avatar" aria-hidden="true">A</div>
                      <div>
                        <div className="message-head"><strong>Athena</strong><span>to {current.draft.recipient}</span></div>
                        <p>{current.draft.body}</p>
                      </div>
                    </div>
                  )}
                </>
              ) : <ApprovalEmptyState run={current} />}

              <details className="disclosure">
                <summary><span>Why this needs attention</span></summary>
                <div className="disclosure-body">
                  <p className="muted small">These dates and the equipment policy explain why I prepared this request.</p>
                  <div className="facts">
                    <div><span>Start date</span><strong>{formatDate(current.facts.start_date)}</strong></div>
                    <div><span>Equipment ETA</span><strong>{formatDate(current.facts.equipment_eta)}</strong></div>
                    <div><span>Task deadline</span><strong>{formatDateTime(current.facts.equipment_task_due_at)}</strong></div>
                    <div><span>Owner</span><strong>{current.facts.equipment_owner_name}</strong></div>
                  </div>
                  <div><p className="muted small">Source policy: {current.facts.policy_page_id}</p><blockquote className="quote">{current.facts.policy_quote}</blockquote></div>
                  <div className="gate"><strong>Your approval</strong>{current.facts.approval_required}</div>
                </div>
              </details>

              {editingEquipment ? (
                <div className="actions draft-edit-actions">
                  <p>Save or cancel your draft edits first. Approval stays disabled while editing.</p>
                  <div className="action-buttons">
                    <button className="button secondary" onClick={cancelEquipmentEdit} disabled={busy !== null}>Cancel</button>
                    <button className="button primary" onClick={saveEquipmentEdit} disabled={busy !== null}>{busy === "edit" ? "Saving..." : "Save"}</button>
                  </div>
                </div>
              ) : isPending ? (
                <div className="actions">
                  <p>I’ve prepared this request. Review the wording before sending.</p>
                 <div className="action-buttons">
                    <button className="button secondary" onClick={() => decide("reject")} disabled={busy !== null}>Reject</button>
                    <button className="button ghost" onClick={beginEquipmentEdit} disabled={busy !== null}>Edit</button>
                   <button className="button primary" onClick={() => decide("approve")} disabled={busy !== null}>{busy === "approve" ? "Sending..." : "Approve and send"}</button>
                 </div>
                </div>
              ) : current.screen_state === "draft_unavailable" ? (
                <div className="outcome unavailable" role="alert">
                  <span className="outcome-icon">!</span>
                  <div><strong>Draft unavailable.</strong><p>{current.draft_unavailable?.message}</p><div style={{ marginTop: 8 }}><button className="button secondary small" onClick={runAssistantAgain} disabled={busy !== null || editingEquipment}>{busy === "retry" ? "Running assistant..." : "Run assistant again"}</button></div></div>
                </div>
              ) : current.screen_state === "no_action" ? (
                <div className="outcome positive" role="status">
                  <span className="outcome-icon">✓</span>
                  <div><strong>Risk cleared from current dates.</strong><p>No outbound action was sent. Change the start date to recalculate the same case.</p></div>
                </div>
              ) : (
                <div className={`outcome ${wasApproved ? "positive" : "negative"}`} role="status">
                  <span className="outcome-icon">{wasApproved ? "✓" : "×"}</span>
                  <div><strong>{wasApproved ? "Sent with approval. Awaiting IT response." : "Nothing was sent."}</strong><p>{current.attention.equipment.next_action}</p></div>
                </div>
              )}
            </div>
          </section>
    );
  }

  function renderEquipment(current: DemoResponse) {
    return (
      <>
        <div className="section-title"><h2>Equipment</h2><p>Delivery dates and the message prepared for IT.</p></div>
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
                <div className="next-action"><strong>Next:</strong> {agentNextAction(current, current.attention.equipment.next_action)}</div>
                {dateChangeNote}
              </div>
            </section>
          </div>

          <section className="panel"><div className="panel-head"><h3>Message history</h3></div><div className="panel-body"><p>{equipmentMessageHistoryText(current)}</p><p className="muted small">{current.draft?.status === "pending" ? "Review and send this message in the conversation." : current.attention.equipment.next_action}</p></div></section>
        </div>

      </>
    );
  }

  function renderBuddyRequest(current: DemoResponse) {
    const request = current.buddy.request;
    if (!request) return null;
    const pending = request.status === "pending_approval";
    const candidate = current.buddy.availability.candidates.find((item) => item.candidate.id === request.candidate_id);
    return (
      <section className="panel prepared-request" aria-label="Buddy request">
        <div className="panel-head"><h3>{pending ? `Buddy request for ${request.candidate_name}` : request.status === "confirmed" ? `${request.candidate_name} is confirmed` : `Buddy support: ${request.candidate_name}`}</h3></div>
        <div className="panel-body stack">
          {pending && <p className="request-context">{request.candidate_name} has two available sessions in {current.joiner.full_name.split(" ")[0]}’s first week. {candidate ? `${candidate.candidate.active_buddies} of 2 buddy places are currently taken.` : "Review the availability before sending."}</p>}
          {pending && current.buddy.draft && <div className="request-wording"><strong>{current.buddy.draft.subject}</strong><p>{current.buddy.draft.body}</p></div>}
          {pending && <div className="action-buttons"><button className="button primary" onClick={() => decideBuddy("approve")} disabled={busy !== null || editingEquipment}>{busy === "buddy_approve" ? "Sending..." : "Approve and send"}</button><button className="button secondary" onClick={() => decideBuddy("reject")} disabled={busy !== null || editingEquipment}>Reject</button></div>}
          {request.status === "awaiting_acceptance" && <p role="status">The request has been sent. We’re waiting for {request.candidate_name} to respond.</p>}
          {request.status === "awaiting_acceptance" && current.buddy.after_approval?.status === "ok" && <details className="disclosure"><summary>Simulate a buddy response</summary><div className="disclosure-body"><p className="muted small">No real buddy was contacted. Choose a response to see how Athena continues.</p><div className="action-buttons"><button className="button secondary" onClick={() => simulateBuddyResponse("declined")} disabled={busy !== null || editingEquipment}>Simulate buddy declines</button><button className="button primary" onClick={() => simulateBuddyResponse("accepted")} disabled={busy !== null || editingEquipment}>Simulate buddy accepts</button></div></div></details>}
          {request.status === "accepted" && <div className="stack" role="status"><p>{request.candidate_name} has accepted. Confirm the allocation to finish arranging {current.joiner.full_name.split(" ")[0]}’s buddy.</p><button className="button primary" onClick={confirmBuddyAllocation} disabled={busy !== null || editingEquipment}>Confirm allocation as People</button></div>}
          {request.status === "confirmed" && <p role="status">People has confirmed the allocation and the two onboarding sessions.</p>}
          {request.status === "rejected" && <p role="status">You rejected this request. Nothing was sent.</p>}
          {request.status === "declined" && <p role="status">{request.candidate_name} declined. {current.attention.buddy.next_action}</p>}
          {request.status === "superseded" && <p role="status">This request was replaced after the dates or availability changed. {current.attention.buddy.next_action}</p>}
          <div className="request-links"><button className="ask-link" onClick={() => setSection("buddy")}>View calendar and other buddies</button><details className="disclosure"><summary>Request history and wording</summary><div className="disclosure-body stack"><p>{request.sent_at ? `Approved and sent ${formatDateTime(request.sent_at)}.` : "Not sent."}{request.response ? ` ${request.candidate_name} ${request.response}.` : ""}{request.confirmed_at ? ` People confirmed ${formatDateTime(request.confirmed_at)}.` : ""}</p>{!pending && current.buddy.draft && <p>{current.buddy.draft.body}</p>}<span className="meta">{current.model.provider === "anthropic" ? "Anthropic wording" : "Fixed mock draft"} · {request.id}</span><div className="slots">{request.slots.map((slot) => <div className="slot" key={slot.id}>{formatSlot(slot)}</div>)}</div></div></details></div>
        </div>
      </section>
    );
  }

  function renderBuddy(current: DemoResponse) {
    const request = buddyRequest;
    const detail = selectedAssessment;
    const canPrepare = !!detail && !hasActiveBuddy && !editingEquipment && busy === null && detail.eligibility.eligible && detail.availability.status === "available";
    return (
      <>
        <div className="section-title"><h2>Buddy support</h2><p>See who has time to support {current.joiner.full_name.split(" ")[0]}. The request stays in the conversation for your review.</p></div>
        <div className="two-col">
          <div className="stack">
            <section className="panel" aria-label="Candidate comparison">
              <div className="panel-head"><h3>Candidates</h3><span className="meta">top {buddyCandidates.length} of {current.buddy.availability.candidates.length} · <span className="sim-badge">Simulated calendar</span></span></div>
              <div>
                {buddyCandidates.map((assessment) => {
                  const { candidate, eligibility, availability } = assessment;
                  const requestTag = candidateRequestTagFor(request, candidate.id);
                  const isRecommended = recommendedBuddy?.candidate_id === candidate.id && !hasActiveBuddy; // a recommendation beside a confirmed or pending buddy reads as a contradiction
                  const isAlternative = alternativeCandidateId === candidate.id;
                  return (
                    <button type="button" className="cand" key={candidate.id} aria-pressed={selectedCandidateId === candidate.id} onClick={() => setSelectedCandidateId(candidate.id)}>
                      <span className="avatar small" aria-hidden="true">{initials(candidate.full_name)}</span>
                      <span className="cand-name"><strong>{candidate.full_name}</strong><span>{candidate.team} · {candidate.office}</span></span>
                      <span className="cand-col"><span>Capacity</span><strong>{candidate.active_buddies} of 2 · {candidate.tenure_months} mo tenure</strong></span>
                      <span className="cand-col"><span>Availability</span><strong className={`availability ${availability.status}`}>{availabilityLabel(availability.status)}{availability.slots.length > 0 ? ` · ${availability.slots.length} slots` : ""}</strong></span>
                      <span className="cand-tags">
                        <Tag tone={eligibility.eligible ? "positive" : "attention"}>{eligibility.eligible ? "Eligible" : "Not eligible"}</Tag>
                        {requestTag ? <Tag tone={requestTag.tone}>{requestTag.label}</Tag> : isRecommended ? <Tag tone="violet">Recommended</Tag> : isAlternative ? <Tag tone="violet">Available alternative</Tag> : null}
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
                  <button className="button secondary small" onClick={() => simulateAvailability(simulationCandidate.candidate.id)} disabled={busy !== null || editingEquipment}>{busy === "availability" ? "Refreshing calendar..." : `Simulate ${simulationCandidate.candidate.full_name} unavailable`}</button>
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
                    {detail.availability.status !== "unavailable" && <WeekStrip assessment={detail} startDate={current.buddy.availability.start_date} request={request} />}
                    {detail.availability.slots.length > 0 && (
                      <div className="slots">
                        {detail.availability.slots.map((slot) => <div className="slot" key={slot.id}><span className="kind">{slot.kind}</span><span className="when">{formatSlot(slot)}</span><span className="tz">{slot.duration_minutes} min · {slot.timezone}</span></div>)}
                      </div>
                    )}
                    {!hasActiveBuddy && (
                      <div className="actions">
                        <p>{canPrepare ? "Prepares an exact request preview. No message is sent yet." : "Only an eligible, available candidate can be requested."}</p>
                        <button className="button primary" onClick={() => prepareBuddy(detail.candidate.id)} disabled={!canPrepare}>{busy === "buddy_prepare" ? "Preparing..." : `Override: request ${detail.candidate.full_name.split(" ")[0]} instead`}</button>
                      </div>
                    )}
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
        <div className="next-action"><strong>Next:</strong> {agentNextAction(current, overallAttentionNextAction(current))}</div>
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
          <div className="sidebar-brand"><Image className="wordmark" src="/humaans-wordmark-white.svg" alt="Humaans" width={112} height={16} style={{ width: "auto", height: 16 }} /><span>demo</span></div>
        </div>
      </aside>

      <div className="main">
        <div className="topnav">
          <div className="topnav-row">{workspace}<span className="sim-badge">Simulated</span></div>
          <nav className="tabs" aria-label="Sections">{navButtons("tab")}</nav>
        </div>

        <div className="viewer-context" aria-label="Your workspace role">
          <strong>People team workspace</strong>
          <span>Demo role: Sarah Mitchell · People team</span>
        </div>
        <header className="case-header">
          <div className="case-identity">
            <span className="avatar" aria-hidden="true">{initials(currentJoinerName)}</span>
            <div>
              <span className="case-caption">Onboarding for</span>
              <h1>{currentJoinerName}</h1>
              <p>{run ? `${run.joiner.title} · ${run.joiner.office} · ${run.joiner.work_mode}` : selectedJoiner.title}</p>
              <p className="case-start">{run ? `Starts ${formatDate(run.joiner.start_date)}` : `Starting ${formatDate(selectedJoiner.start_date)}`}</p>
            </div>
          </div>
          <div className="header-controls">
            <div className="field joiner-switcher">
              <label htmlFor="joiner-select">Joiner</label>
              <select id="joiner-select" value={selectedJoinerId} onChange={(event) => switchJoiner(event.target.value)} disabled={busy !== null || draftEditBlocksMutations}>
                {DEMO_JOINERS.map((joiner) => <option key={joiner.id} value={joiner.id}>{joiner.full_name}</option>)}
              </select>
            </div>
            {run && <div className="field">
              <label htmlFor="start-date">Start date</label>
              <div className="field-row">
                <input id="start-date" className="date-input" type="date" value={dateDraft} onChange={(event) => setDateDraft(event.target.value)} disabled={!run || run.phase === "resolved" || busy !== null || draftEditBlocksMutations} />
                <button className="button secondary" onClick={changeStartDate} disabled={!run || run.phase === "resolved" || busy !== null || draftEditBlocksMutations || !dateDraft || dateDraft === run.joiner.start_date}>{busy === "date" ? "Recalculating..." : "Update start date"}</button>
              </div>
            </div>}
            <details className="demo-controls"><summary>Demo controls</summary>
              <div className="demo-actions">
                <button className="button primary" onClick={startFlow} disabled={busy !== null || editingEquipment || editingManager || run !== null}>{busy === "start" ? "Processing event..." : "Simulate contract signed"}</button>
                {run?.joiner.id === "J-001" && <button className="button secondary" onClick={simulateSupplierUpdate} disabled={busy !== null || draftEditBlocksMutations || supplierUpdateWaiting}>{busy === "supplier" ? "Updating supplier..." : supplierUpdateWaiting ? "Supplier update recorded" : run.facts.equipment_eta === "2026-10-09" ? "Restore supplier ETA" : "Simulate supplier delay"}</button>}
                <button className="button secondary" onClick={resetFlow} disabled={busy !== null || editingEquipment || editingManager || run === null}>{busy === "reset" ? "Resetting..." : "Reset all demo cases"}</button>
              </div>
            </details>
          </div>
        </header>

        {error && <div className="error-banner" role="alert">{error}</div>}
        {run && <div className={`monitor-bar ${currentMonitor?.state ?? "watching"}`} role="status" aria-live="polite">
          <span className="monitor-dot" aria-hidden="true" />
          <strong>{monitorStatusLabel(currentMonitor?.state ?? null)}</strong>
          <span>{currentMonitor?.last_successful_check_at ? `Last checked ${formatDateTime(currentMonitor.last_successful_check_at)}` : "Waiting for the first background check"}</span>
          <span className="sim-badge">Simulated systems</span>
          {currentMonitor?.next_action && <span>{currentMonitor.next_action}</span>}
          {monitorError && <span className="monitor-error">{monitorError}</span>}
        </div>}
        <BackgroundUpdateNotice hasUpdate={backgroundUpdate !== null} editingEquipment={editingEquipment} editingManager={editingManager} />

        <main className="work">
          {!run && <div className="conversation-entry"><BotanicalWelcome entry joinerName={currentJoinerName} preferredName={currentPreferredName} />{renderAskAthena(false, true)}<details className="disclosure entry-event"><summary>Or start with a contract-signed event</summary><WorkflowTriggerCard busy={busy !== null} onTrigger={startFlow} /></details></div>}
          {run && <div className={`conversation-layout ${section !== "overview" ? "with-details" : ""}`}>
            <div className="conversation-main"><BotanicalWelcome focus={workFocus} joinerName={currentJoinerName} preferredName={currentPreferredName} />
              {monitorNotifications.length > 0 && <section className="monitor-notifications" aria-label="Equipment monitoring updates">{monitorNotifications.map(({ notification, monitoredCase }) => {
                const isCurrentCase = monitoredCase.case.id === run.case.id;
                return <article className="monitor-notification" key={notification.id}>
                  <div><span className="notification-label">Athena noticed a supplier change</span><strong>{monitoredCase.joiner.full_name}</strong><p>{monitorNotificationText(notification, monitoredCase)}</p><span className="meta">Checked {formatDateTime(notification.at)} · People approval is still required for any message.</span></div>
                  <div className="monitor-notification-actions">
                    <button className="button secondary small" onClick={() => void reviewMonitorAlert(notification)} disabled={monitorNotificationNavigationBlocked(busy !== null, editingEquipment, editingManager)}>{isCurrentCase ? "Review equipment" : `View ${monitoredCase.joiner.full_name.split(" ")[0]}`}</button>
                    <button className="button ghost small" onClick={() => dismissMonitorAlert(notification)} aria-label={`Dismiss ${monitoredCase.joiner.full_name.split(" ")[0]}'s equipment alert`}>Dismiss</button>
                  </div>
                </article>;
              })}</section>}
              {supplierUpdateWaiting && <p className="supplier-pending" role="status">Supplier update recorded. Athena will assess it independently on the next background check.</p>}
              {renderAskAthena()}
              <details className="disclosure technical-drawer"><summary>How Athena reached this</summary><div className="disclosure-body">{renderCaseDetails(run)}{renderActivity(run)}</div></details>
            </div>
            {section !== "overview" && <aside className="context-panel" aria-label="Onboarding details" onKeyDown={(event) => { if (event.key === "Escape") { setSection("overview"); document.getElementById("ask-question")?.focus(); } }}><div className="context-heading"><strong>{section === "equipment" ? "Equipment" : section === "buddy" ? "Buddy availability" : section === "profile" ? "Employee profile" : "How Athena reached this"}</strong><button autoFocus className="button ghost small" onClick={() => { setSection("overview"); document.getElementById("ask-question")?.focus(); }}>Close details</button></div>
              {section === "equipment" && renderEquipment(run)}
              {section === "buddy" && renderBuddy(run)}
              {section === "activity" && renderActivity(run)}
              {section === "profile" && run.onboarding && <JoinerProfile view={run.onboarding} />}
            </aside>}
          </div>}
        </main>

        <footer className="app-foot">Athena for Quilstead · Demo with fictional people and simulated systems</footer>
      </div>
    </div>
  );
}
