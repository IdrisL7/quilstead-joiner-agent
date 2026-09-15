import { discardDraft } from "@/lib/connectors/simulated/messaging";
import type { EquipmentSourceObservation } from "@/lib/connectors/simulated/equipment";
import {
  readEquipmentSource,
  reassessDemoEquipment,
  sameEquipmentObservation,
  type DemoPreparation,
} from "@/lib/demo-flow";
import {
  beginDemoMutation,
  captureDemoRun,
  commitDemoRun,
  demoMutationInFlight,
  endDemoMutation,
  getDemoRun,
} from "@/lib/store/demo-session";

export const EQUIPMENT_MONITOR_INTERVAL_MS = 15_000;
export const EQUIPMENT_MONITOR_MAX_INVOCATIONS = 6;
const MAX_ATTEMPTS_PER_OBSERVATION = 2;

export type EquipmentMonitorState = "watching" | "checking" | "needs_attention" | "paused";

export interface EquipmentMonitorNotification {
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

interface MonitoredCase {
  case_id: string;
  joiner_id: string;
  state: EquipmentMonitorState;
  last_observed: EquipmentSourceObservation;
  last_reconciled: EquipmentSourceObservation;
  last_checked_at: string | null;
  last_successful_check_at: string | null;
  failed_observation_key: string | null;
  failed_attempts: number;
  last_error: string | null;
  next_action: string | null;
}

export interface EquipmentMonitorSnapshot {
  running: boolean;
  interval_ms: number;
  provider: "mock" | "anthropic";
  agent_invocations: number;
  max_agent_invocations: number;
  scheduler_starts: number;
  cases: Array<MonitoredCase>;
  notifications: EquipmentMonitorNotification[];
}

interface MonitorDependencies {
  now?: () => string;
  intervalMs?: number;
  maxInvocations?: number;
  mode?: () => "mock" | "live";
  readSource?: typeof readEquipmentSource;
  reassess?: typeof reassessDemoEquipment;
}

function observationKey(observation: EquipmentSourceObservation): string {
  return `${observation.signature}:${observation.source_revision}`;
}

function discardUncommittedDraft(before: DemoPreparation, after: DemoPreparation): void {
  const draft = after.draft;
  if (draft?.status === "pending" && draft.id !== before.draft?.id) discardDraft(draft.id);
}

export class EquipmentMonitor {
  private readonly now: () => string;
  private readonly intervalMs: number;
  private readonly maxInvocations: number;
  private readonly mode: () => "mock" | "live";
  private readonly readSource: typeof readEquipmentSource;
  private readonly reassess: typeof reassessDemoEquipment;
  private cases = new Map<string, MonitoredCase>();
  private notifications = new Map<string, EquipmentMonitorNotification>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private tickInFlight = false;
  private agentInvocations = 0;
  private schedulerStarts = 0;

  constructor(dependencies: MonitorDependencies = {}) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.intervalMs = dependencies.intervalMs ?? EQUIPMENT_MONITOR_INTERVAL_MS;
    this.maxInvocations = dependencies.maxInvocations ?? EQUIPMENT_MONITOR_MAX_INVOCATIONS;
    this.mode = dependencies.mode ?? (() => process.env.EQUIPMENT_MONITOR_MODE === "live" ? "live" : "mock");
    this.readSource = dependencies.readSource ?? readEquipmentSource;
    this.reassess = dependencies.reassess ?? reassessDemoEquipment;
  }

  register(run: DemoPreparation): void {
    if (this.cases.has(run.case.id)) return;
    this.cases.set(run.case.id, {
      case_id: run.case.id,
      joiner_id: run.joiner.id,
      state: "watching",
      last_observed: structuredClone(run.equipment_observation),
      last_reconciled: structuredClone(run.equipment_observation),
      last_checked_at: null,
      last_successful_check_at: null,
      failed_observation_key: null,
      failed_attempts: 0,
      last_error: null,
      next_action: null,
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedulerStarts += 1;
    this.scheduleNext();
  }

  reset(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.tickInFlight = false;
    this.cases.clear();
    this.notifications.clear();
    this.agentInvocations = 0;
    this.schedulerStarts = 0;
  }

  snapshot(): EquipmentMonitorSnapshot {
    return {
      running: this.running,
      interval_ms: this.intervalMs,
      provider: this.mode() === "live" ? "anthropic" : "mock",
      agent_invocations: this.agentInvocations,
      max_agent_invocations: this.maxInvocations,
      scheduler_starts: this.schedulerStarts,
      cases: [...this.cases.values()].map((entry) => structuredClone(entry)),
      notifications: [...this.notifications.values()].map((entry) => structuredClone(entry)),
    };
  }

  async tick(): Promise<void> {
    if (this.tickInFlight || demoMutationInFlight()) return;
    this.tickInFlight = true;
    try {
      for (const caseId of [...this.cases.keys()]) await this.tickCase(caseId);
    } finally {
      this.tickInFlight = false;
    }
  }

  private scheduleNext(): void {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.tick();
      } finally {
        this.scheduleNext();
      }
    }, this.intervalMs);
    this.timer.unref?.();
  }

  private async tickCase(caseId: string): Promise<void> {
    const tracked = this.cases.get(caseId);
    const currentRun = getDemoRun(caseId);
    if (!tracked || !currentRun) {
      this.cases.delete(caseId);
      return;
    }

    const checkedAt = this.now();
    tracked.last_checked_at = checkedAt;
    let source;
    try {
      source = await this.readSource(tracked.joiner_id);
      tracked.last_observed = structuredClone(source.observation);
      tracked.last_successful_check_at = checkedAt;
    } catch (error) {
      tracked.last_error = error instanceof Error ? error.message : "Equipment source read failed.";
      const failureKey = `source:${tracked.last_error}`;
      tracked.failed_attempts = tracked.failed_observation_key === failureKey ? tracked.failed_attempts + 1 : 1;
      tracked.failed_observation_key = failureKey;
      tracked.state = tracked.failed_attempts >= MAX_ATTEMPTS_PER_OBSERVATION ? "needs_attention" : "watching";
      tracked.next_action = tracked.state === "needs_attention" ? "Retry the equipment check explicitly." : "Athena will retry the equipment check once.";
      return;
    }

    const reconciledOutsideMonitor = sameEquipmentObservation(currentRun.equipment_observation, source.observation)
      && !currentRun.draft_unavailable
      && !sameEquipmentObservation(tracked.last_reconciled, source.observation);
    if (reconciledOutsideMonitor) {
      tracked.last_reconciled = structuredClone(source.observation);
      tracked.failed_observation_key = null;
      tracked.failed_attempts = 0;
      tracked.last_error = null;
      tracked.next_action = null;
      tracked.state = "watching";
      return;
    }

    if (sameEquipmentObservation(source.observation, tracked.last_reconciled)) {
      if (tracked.failed_observation_key && !currentRun.draft_unavailable
        && sameEquipmentObservation(currentRun.equipment_observation, source.observation)) {
        tracked.failed_observation_key = null;
        tracked.failed_attempts = 0;
        tracked.last_error = null;
        tracked.next_action = null;
      }
      tracked.state = "watching";
      return;
    }

    const key = observationKey(source.observation);
    if (tracked.failed_observation_key === key && tracked.failed_attempts >= MAX_ATTEMPTS_PER_OBSERVATION) {
      tracked.state = "needs_attention";
      tracked.next_action = "Retry the equipment reassessment explicitly.";
      return;
    }
    if (this.agentInvocations >= this.maxInvocations) {
      tracked.state = "paused";
      tracked.next_action = "Equipment monitoring reached its local session limit.";
      return;
    }

    const token = beginDemoMutation();
    if (!token) return;
    const captured = captureDemoRun(caseId);
    if (!captured) {
      endDemoMutation(token);
      return;
    }

    tracked.state = "checking";
    this.agentInvocations += 1;
    let result: DemoPreparation | null = null;
    try {
      result = await this.reassess(
        captured.run,
        this.mode(),
        checkedAt,
        { force: tracked.failed_observation_key === key, detectedByMonitor: true },
      );
      const verified = await this.readSource(tracked.joiner_id);
      if (!sameEquipmentObservation(result.equipment_observation, verified.observation)) {
        discardUncommittedDraft(captured.run, result);
        tracked.last_observed = structuredClone(verified.observation);
        tracked.state = "watching";
        tracked.next_action = "A newer supplier update will be checked on the next tick.";
        return;
      }

      if (!commitDemoRun(captured, result)) {
        discardUncommittedDraft(captured.run, result);
        tracked.state = "watching";
        tracked.next_action = "The case changed while equipment was checked; the stale result was discarded.";
        return;
      }

      if (result.draft_unavailable) {
        const sameFailure = tracked.failed_observation_key === key;
        tracked.failed_observation_key = key;
        tracked.failed_attempts = sameFailure ? tracked.failed_attempts + 1 : 1;
        tracked.last_error = result.draft_unavailable.message;
        tracked.state = tracked.failed_attempts >= MAX_ATTEMPTS_PER_OBSERVATION ? "needs_attention" : "watching";
        tracked.next_action = tracked.state === "needs_attention" ? "Retry the equipment reassessment explicitly." : "Athena will retry this changed observation once.";
        return;
      }

      result.trace = [...result.trace, {
        actor: "agent",
        kind: result.facts.equipment_late ? "equipment.monitor.proposed" : "equipment.monitor.cleared",
        summary: result.facts.equipment_late
          ? `Athena prepared an equipment request for ${result.facts.equipment_owner_name}; People approval is still required.`
          : `Athena confirmed the equipment ETA no longer falls after ${result.joiner.preferred_name}'s start date; no message was prepared.`,
      }];

      const notificationId = `${caseId}:${key}`;
      this.notifications.set(notificationId, {
        id: notificationId,
        case_id: caseId,
        joiner_id: tracked.joiner_id,
        at: checkedAt,
        source_revision: source.observation.source_revision,
        equipment_eta: result.facts.equipment_eta,
        start_date: result.facts.start_date,
        outcome: result.facts.equipment_late ? "proposal_prepared" : "risk_cleared",
        draft_id: result.draft?.id ?? null,
      });
      tracked.last_reconciled = structuredClone(result.equipment_observation);
      tracked.failed_observation_key = null;
      tracked.failed_attempts = 0;
      tracked.last_error = null;
      tracked.next_action = null;
      tracked.state = "watching";
    } catch (error) {
      if (result) discardUncommittedDraft(captured.run, result);
      const sameFailure = tracked.failed_observation_key === key;
      tracked.failed_observation_key = key;
      tracked.failed_attempts = sameFailure ? tracked.failed_attempts + 1 : 1;
      tracked.last_error = error instanceof Error ? error.message : "Equipment reassessment failed.";
      tracked.state = tracked.failed_attempts >= MAX_ATTEMPTS_PER_OBSERVATION ? "needs_attention" : "watching";
      tracked.next_action = tracked.state === "needs_attention" ? "Retry the equipment reassessment explicitly." : "Athena will retry this changed observation once.";
    } finally {
      endDemoMutation(token);
    }
  }
}

export const equipmentMonitor = new EquipmentMonitor();

export function registerEquipmentMonitorCase(run: DemoPreparation): void {
  equipmentMonitor.register(run);
  equipmentMonitor.start();
}

export function resetEquipmentMonitor(): void {
  equipmentMonitor.reset();
}
