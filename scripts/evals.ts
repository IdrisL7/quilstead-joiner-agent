import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EVENTS } from "@/data/events";
import { joinerById } from "@/data/joiners";
import { LATE_FOR } from "@/lib/connectors/simulated/equipment";
import { findAction } from "@/lib/connectors/registry";
import {
  changeDemoStartDate,
  prepareManagerCoordination,
  prepareDemo,
  reassessDemoEquipment,
  requestDemoAccess,
  recordBuddyResponse,
  resolveBuddyApproval,
  simulateBuddyAvailabilityChange,
} from "@/lib/demo-flow";
import { runAgent } from "@/lib/agent/loop";
import type { AgentMode, AgentRun, AgentTrigger } from "@/lib/agent/types";
import { CaseStore } from "@/lib/store/case-store";
import { resetDemoState } from "@/lib/store/demo-state";
import type { Case } from "@/lib/types";

const NOW = "2026-09-30T09:00:00Z";
const GOLDEN_PATH = path.join(process.cwd(), "data", "golden", "cases.json");
const DEFAULT_LIVE_BUDGET_USD = 2;

interface GoldenExpected {
  run?: boolean;
  stop_reason?: AgentRun["stop_reason"] | null;
  proposal_kinds?: string[];
  proposal_recipients?: string[];
  escalation_codes?: string[];
  terminal_case_state?: string;
  next_action_prefix?: string | null;
}

interface GoldenScenario {
  id: string;
  label: string;
  joiner_id: string;
  trigger: AgentTrigger;
  start_date?: string;
  candidate_id?: string;
  equipment_on_track?: boolean;
  equipment_update_eta?: string;
  equipment_update_status?: "ordered" | "backordered";
  expected: GoldenExpected;
}

interface ScenarioOutcome {
  case: Case | null;
  agent?: AgentRun;
  error?: string;
}

interface ScenarioActual {
  run: boolean;
  stop_reason: AgentRun["stop_reason"] | null;
  proposal_kinds: string[];
  proposal_recipients: string[];
  escalation_codes: string[];
  terminal_case_state: string | null;
  next_action: string | null;
  model_steps: number;
  tool_calls: number;
  refused: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  wall_ms: number;
  error?: string;
}

interface AttemptResult {
  pass: boolean;
  actual: ScenarioActual;
  mismatches: string[];
  notes: string[]; // guard refusals, reminders, retries, unavailable reasons from the run trace
}

function parseFlag(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function loadScenarios(): GoldenScenario[] {
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenScenario[];
}

async function runContractScenario(joinerId: string, mode: AgentMode): Promise<ScenarioOutcome> {
  resetDemoState();
  const joiner = joinerById(joinerId);
  const event = EVENTS.find((candidate) => candidate.joiner_id === joinerId && candidate.type === "contract.signed");
  if (!joiner || !event) throw new Error(`Missing contract fixture for ${joinerId}`);

  const store = new CaseStore();
  const opened = store.open(event, joiner, NOW);
  if (!opened.case) throw new Error(`Case did not open for ${joinerId}: ${opened.outcome}`);
  if (opened.outcome !== "opened") return { case: opened.case };

  const equipment = findAction("equipment.order");
  if (!equipment) throw new Error("Equipment order action is not registered");
  await equipment.action.run({
    joiner_id: joiner.id,
    model: joiner.equipment_preference,
    ship_to: joiner.work_mode === "remote" ? "home" : "office",
    now: NOW,
  });

  const agent = await runAgent(opened.case, joiner, "contract.signed", NOW, mode);
  return { case: opened.case, agent };
}

async function runScenario(scenario: GoldenScenario, mode: AgentMode): Promise<ScenarioOutcome> {
  // Every golden attempt is an isolated demo. prepareDemo is intentionally side-effect free
  // with respect to global resets so the evaluator owns this boundary explicitly.
  resetDemoState();
  const wasLate = LATE_FOR.has(scenario.joiner_id);
  if (scenario.equipment_on_track) LATE_FOR.delete(scenario.joiner_id);
  try {
    if (scenario.trigger === "contract.signed") return runContractScenario(scenario.joiner_id, mode);

    // Fixture setup always uses the deterministic mock so the scenario's trigger is the only
    // thing the model under test has to handle.
    const initial = await prepareDemo(NOW, "mock", scenario.joiner_id);
    if (scenario.trigger === "equipment_changed") {
      const update = findAction("equipment.update_order");
      if (!update) throw new Error("Equipment update action is not registered");
      const sourceChange = await update.action.run({
        joiner_id: scenario.joiner_id,
        eta: scenario.equipment_update_eta,
        status: scenario.equipment_update_status,
        now: NOW,
      });
      if (sourceChange.status !== "ok") throw new Error(sourceChange.summary);
      const reassessed = await reassessDemoEquipment(initial, mode, NOW);
      return { case: reassessed.case, agent: reassessed.agent };
    }
    if (scenario.trigger === "access_requested") {
      const requested = await requestDemoAccess(initial, mode, NOW);
      return { case: requested.case, agent: requested.agent };
    }
    if (scenario.trigger === "manager_coordination") {
      const coordinated = await prepareManagerCoordination(initial, mode, NOW);
      return { case: coordinated.case, agent: coordinated.agent };
    }
    if (scenario.trigger === "start_date_changed") {
      const changed = await changeDemoStartDate(initial, scenario.start_date!, mode, NOW);
      return { case: changed.case, agent: changed.agent };
    }
    if (scenario.trigger === "buddy_declined") {
      const request = initial.buddy.request;
      const draft = initial.buddy.draft;
      if (!request || !draft) throw new Error("Buddy decline fixture has no pending request");
      const approved = await resolveBuddyApproval(initial, request.id, draft.id, "approve");
      const declined = await recordBuddyResponse(approved.preparation, request.id, "declined", NOW, mode);
      return { case: declined.preparation.case, agent: declined.preparation.agent };
    }
    if (scenario.trigger === "availability_changed") {
      const changed = await simulateBuddyAvailabilityChange(initial, scenario.candidate_id!, NOW, mode);
      return { case: changed.case, agent: changed.agent };
    }
    throw new Error(`Unsupported golden trigger ${scenario.trigger}`);
  } catch (error) {
    return { case: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (wasLate) LATE_FOR.add(scenario.joiner_id);
  }
}

function actualFor(outcome: ScenarioOutcome, wallMs: number): ScenarioActual {
  const agent = outcome.agent;
  return {
    run: Boolean(agent),
    stop_reason: agent?.stop_reason ?? null,
    proposal_kinds: agent?.proposals.map((proposal) => proposal.draft.kind) ?? [],
    proposal_recipients: agent?.proposals.map((proposal) => proposal.draft.to) ?? [],
    escalation_codes: [...new Set(outcome.case?.escalations.map((escalation) => escalation.code) ?? [])].sort(),
    terminal_case_state: outcome.case?.state ?? null,
    next_action: agent?.next_action ?? null,
    model_steps: agent?.model_steps ?? 0,
    tool_calls: agent?.tool_calls ?? 0,
    refused: agent?.refused ?? 0,
    input_tokens: agent?.input_tokens ?? 0,
    output_tokens: agent?.output_tokens ?? 0,
    cost_usd: agent?.cost_usd ?? 0,
    wall_ms: wallMs,
    ...(outcome.error ? { error: outcome.error } : {}),
  };
}

function sameArray(actual: string[], expected: string[] | undefined): boolean {
  return expected ? JSON.stringify(actual) === JSON.stringify(expected) : false;
}

function terminalSignature(actual: ScenarioActual): string {
  return JSON.stringify({
    run: actual.run,
    stop_reason: actual.stop_reason,
    proposal_kinds: actual.proposal_kinds,
    proposal_recipients: actual.proposal_recipients,
    escalation_codes: actual.escalation_codes,
    terminal_case_state: actual.terminal_case_state,
    error: actual.error ?? null,
  });
}

// Mock grades the exact next_action prefix (it is the golden wording). Live grades that a
// next action exists and is one sentence; wording is the model's. Everything else is strict.
function mismatches(actual: ScenarioActual, expected: GoldenExpected, mode: AgentMode): string[] {
  const out: string[] = [];
  if ((expected.run ?? true) !== actual.run) out.push(`run: expected ${expected.run ?? true}, got ${actual.run}${actual.error ? ` (${actual.error})` : ""}`);
  if (expected.stop_reason !== undefined && expected.stop_reason !== actual.stop_reason) out.push(`stop_reason: expected ${expected.stop_reason}, got ${actual.stop_reason}`);
  if (mode === "mock") {
    if (expected.proposal_kinds !== undefined && !sameArray(actual.proposal_kinds, expected.proposal_kinds)) out.push(`proposal_kinds: expected ${JSON.stringify(expected.proposal_kinds)}, got ${JSON.stringify(actual.proposal_kinds)}`);
    if (expected.proposal_recipients !== undefined && !sameArray(actual.proposal_recipients, expected.proposal_recipients)) out.push(`proposal_recipients: expected ${JSON.stringify(expected.proposal_recipients)}, got ${JSON.stringify(actual.proposal_recipients)}`);
    if (expected.escalation_codes !== undefined && !sameArray(actual.escalation_codes, expected.escalation_codes)) out.push(`escalation_codes: expected ${JSON.stringify(expected.escalation_codes)}, got ${JSON.stringify(actual.escalation_codes)}`);
  } else {
    // Live: the golden outcomes are the minimum. The model may add SOP-consistent work: a nudge
    // to another open-task owner, or an OWNER_SLA_BREACHED / COMPLIANCE_DEADLINE_AT_RISK
    // escalation. Anything else extra, or anything expected but missing, is a miss.
    const expectedPairs = (expected.proposal_kinds ?? []).map((kind, index) => `${kind}:${expected.proposal_recipients?.[index] ?? "*"}`);
    const actualPairs = actual.proposal_kinds.map((kind, index) => `${kind}:${actual.proposal_recipients[index]}`);
    for (const pair of expectedPairs) {
      const [kind, to] = pair.split(":");
      if (!actualPairs.some((candidate) => candidate === pair || (to === "*" && candidate.startsWith(`${kind}:`)))) out.push(`missing proposal ${pair}; got ${JSON.stringify(actualPairs)}`);
    }
    for (const pair of actualPairs) {
      const [kind] = pair.split(":");
      const matchesExpected = expectedPairs.some((candidate) => candidate === pair || candidate === `${kind}:*`);
      if (!matchesExpected && kind !== "nudge") out.push(`unexpected proposal ${pair}`);
    }
    const allowedExtras = new Set(["OWNER_SLA_BREACHED", "COMPLIANCE_DEADLINE_AT_RISK"]);
    for (const code of expected.escalation_codes ?? []) if (!actual.escalation_codes.includes(code)) out.push(`missing escalation ${code}; got ${JSON.stringify(actual.escalation_codes)}`);
    for (const code of actual.escalation_codes) if (!(expected.escalation_codes ?? []).includes(code) && !allowedExtras.has(code)) out.push(`unexpected escalation ${code}`);
  }
  if (expected.terminal_case_state !== undefined && expected.terminal_case_state !== actual.terminal_case_state) out.push(`terminal_case_state: expected ${expected.terminal_case_state}, got ${actual.terminal_case_state}`);
  if (expected.next_action_prefix !== undefined) {
    if (expected.next_action_prefix === null) {
      if (actual.next_action !== null) out.push("next_action: expected none");
    } else if (mode === "mock") {
      if (actual.next_action?.startsWith(expected.next_action_prefix) !== true) out.push(`next_action: expected prefix "${expected.next_action_prefix}"`);
    } else if (!actual.next_action || actual.next_action.length > 240) {
      out.push(`next_action: expected one sentence under 240 chars, got ${actual.next_action?.length ?? 0} chars`);
    }
  }
  return out;
}

function grade(actual: ScenarioActual, expected: GoldenExpected, mode: AgentMode): boolean {
  return mismatches(actual, expected, mode).length === 0;
}

const NOTE_KINDS = new Set(["agent.guard.refused", "agent.unavailable", "agent.reminded", "agent.retried", "agent.implicit_finish"]);
function notesFor(outcome: ScenarioOutcome): string[] {
  return outcome.agent?.trace.filter((entry) => NOTE_KINDS.has(entry.kind)).map((entry) => `${entry.kind}: ${entry.summary}`) ?? [];
}

function printTable(results: Array<{ scenario: GoldenScenario; attempts: AttemptResult[] }>, passes: number, budgetExceeded: boolean, budgetUsd: number): void {
  console.log("| Scenario | pass count | flapping | stop reason | next action |");
  console.log("|---|---:|:---:|---|---|");
  for (const result of results) {
    const signatures = new Set(result.attempts.map((attempt) => terminalSignature(attempt.actual)));
    const passed = result.attempts.filter((attempt) => attempt.pass).length;
    const latest = result.attempts.at(-1)?.actual;
    console.log(`| ${result.scenario.id} | ${passed}/${passes} | ${signatures.size > 1 ? "yes" : "no"} | ${latest?.stop_reason ?? "none"} | ${latest?.next_action ?? "none"} |`);
  }
  const allAttempts = results.flatMap((result) => result.attempts);
  const passingScenarios = results.filter((result) => result.attempts.some((attempt) => attempt.pass)).length;
  const reliableScenarios = results.filter((result) => result.attempts.length === passes && result.attempts.every((attempt) => attempt.pass)).length;
  const flapping = results.filter((result) => new Set(result.attempts.map((attempt) => terminalSignature(attempt.actual))).size > 1).length;
  const meanCost = allAttempts.length === 0 ? 0 : allAttempts.reduce((sum, attempt) => sum + attempt.actual.cost_usd, 0) / allAttempts.length;
  const meanTools = allAttempts.length === 0 ? 0 : allAttempts.reduce((sum, attempt) => sum + attempt.actual.tool_calls, 0) / allAttempts.length;
  const meanWallMs = allAttempts.length === 0 ? 0 : allAttempts.reduce((sum, attempt) => sum + attempt.actual.wall_ms, 0) / allAttempts.length;
  console.log("");
  console.log(`pass@${passes}: ${passingScenarios}/${results.length}`);
  console.log(`pass^${passes}: ${reliableScenarios}/${results.length}`);
  console.log(`flapping: ${flapping}`);
  console.log(`mean cost: $${meanCost.toFixed(6)} per run`);
  console.log(`mean tool calls: ${meanTools.toFixed(2)}`);
  console.log(`mean wall time: ${meanWallMs.toFixed(0)} ms per run`);
  if (budgetExceeded) console.log(`budget: stopped at the USD ${budgetUsd.toFixed(2)} cap`);
  const misses = results.filter((result) => result.attempts.some((attempt) => !attempt.pass));
  if (misses.length > 0) {
    console.log("\nmisses:");
    for (const result of misses) {
      for (const [index, attempt] of result.attempts.entries()) {
        if (attempt.pass) continue;
        console.log(`- ${result.scenario.id} #${index + 1}: ${attempt.mismatches.join(" | ")}`);
        for (const note of attempt.notes) console.log(`    ${note}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const mode = parseFlag("--mode", "mock") as AgentMode;
  const passes = Number.parseInt(parseFlag("--passes", "3"), 10);
  const outputPath = parseFlag("--out", path.join(process.cwd(), "docs", "evals", `${new Date().toISOString().slice(0, 10)}-${mode}.json`));
  const inspect = process.argv.includes("--inspect");
  const only = parseFlag("--only", "");
  const paceMs = Number.parseInt(parseFlag("--pace-ms", "8000"), 10);
  const LIVE_BUDGET_USD = Number.parseFloat(parseFlag("--budget-usd", String(DEFAULT_LIVE_BUDGET_USD)));
  if (!Number.isFinite(LIVE_BUDGET_USD) || LIVE_BUDGET_USD <= 0) throw new Error("--budget-usd must be a positive number");
  if (mode !== "mock" && mode !== "live") throw new Error("--mode must be mock or live");
  if (!Number.isInteger(passes) || passes < 1) throw new Error("--passes must be a positive integer");

  const scenarios = loadScenarios();
  const selected = only ? scenarios.filter((scenario) => only.split(",").includes(scenario.id)) : scenarios;
  if (selected.length === 0) throw new Error(`--only matched no scenario: ${only}`);
  const results: Array<{ scenario: GoldenScenario; attempts: AttemptResult[] }> = [];
  let cumulativeCost = 0;
  let budgetExceeded = false;

  for (const scenario of selected) {
    const attempts: AttemptResult[] = [];
    for (let pass = 0; pass < passes; pass += 1) {
      if (mode === "live" && cumulativeCost >= LIVE_BUDGET_USD) {
        budgetExceeded = true;
        break;
      }
      const startedAt = Date.now();
      const outcome = await runScenario(scenario, mode);
      const actual = actualFor(outcome, Date.now() - startedAt);
      const notes = notesFor(outcome);
      cumulativeCost += actual.cost_usd;
      attempts.push({ pass: inspect || grade(actual, scenario.expected, mode), actual, mismatches: mismatches(actual, scenario.expected, mode), notes });
      if (mode === "live" && paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
    results.push({ scenario, attempts });
    if (budgetExceeded) break;
  }

  const output = {
    generated_at: new Date().toISOString(),
    mode,
    model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    passes,
    budget_usd: mode === "live" ? LIVE_BUDGET_USD : null,
    cumulative_cost_usd: cumulativeCost,
    budget_exceeded: budgetExceeded,
    results,
  };
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  printTable(results, passes, budgetExceeded, LIVE_BUDGET_USD);
  console.log(`output: ${outputPath}`);

  const complete = results.length === scenarios.length && results.every((result) => result.attempts.length === passes);
  const passed = complete && results.every((result) => result.attempts.every((attempt) => attempt.pass));
  if (!inspect && !passed) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
