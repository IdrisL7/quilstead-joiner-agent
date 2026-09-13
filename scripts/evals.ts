import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EVENTS } from "@/data/events";
import { joinerById } from "@/data/joiners";
import { LATE_FOR } from "@/lib/connectors/simulated/equipment";
import { findAction } from "@/lib/connectors/registry";
import {
  changeDemoStartDate,
  prepareDemo,
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
const LIVE_BUDGET_USD = 2;

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
  const wasLate = LATE_FOR.has(scenario.joiner_id);
  if (scenario.equipment_on_track) LATE_FOR.delete(scenario.joiner_id);
  try {
    if (scenario.trigger === "contract.signed") return runContractScenario(scenario.joiner_id, mode);

    const initial = await prepareDemo(NOW, mode);
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
    next_action: actual.next_action,
    error: actual.error ?? null,
  });
}

function grade(actual: ScenarioActual, expected: GoldenExpected): boolean {
  return (expected.run ?? true) === actual.run
    && (expected.stop_reason === undefined || expected.stop_reason === actual.stop_reason)
    && (expected.proposal_kinds === undefined || sameArray(actual.proposal_kinds, expected.proposal_kinds))
    && (expected.proposal_recipients === undefined || sameArray(actual.proposal_recipients, expected.proposal_recipients))
    && (expected.escalation_codes === undefined || sameArray(actual.escalation_codes, expected.escalation_codes))
    && (expected.terminal_case_state === undefined || expected.terminal_case_state === actual.terminal_case_state)
    && (expected.next_action_prefix === undefined
      ? true
      : expected.next_action_prefix === null
      ? actual.next_action === null
      : actual.next_action?.startsWith(expected.next_action_prefix) === true);
}

function printTable(results: Array<{ scenario: GoldenScenario; attempts: AttemptResult[] }>, passes: number, budgetExceeded: boolean): void {
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
  if (budgetExceeded) console.log(`budget: stopped at the USD ${LIVE_BUDGET_USD.toFixed(2)} cap`);
}

async function main(): Promise<void> {
  const mode = parseFlag("--mode", "mock") as AgentMode;
  const passes = Number.parseInt(parseFlag("--passes", "3"), 10);
  const outputPath = parseFlag("--out", path.join(process.cwd(), "docs", "evals", `${new Date().toISOString().slice(0, 10)}-${mode}.json`));
  const inspect = process.argv.includes("--inspect");
  if (mode !== "mock" && mode !== "live") throw new Error("--mode must be mock or live");
  if (!Number.isInteger(passes) || passes < 1) throw new Error("--passes must be a positive integer");

  const scenarios = loadScenarios();
  const results: Array<{ scenario: GoldenScenario; attempts: AttemptResult[] }> = [];
  let cumulativeCost = 0;
  let budgetExceeded = false;

  for (const scenario of scenarios) {
    const attempts: AttemptResult[] = [];
    for (let pass = 0; pass < passes; pass += 1) {
      if (mode === "live" && cumulativeCost >= LIVE_BUDGET_USD) {
        budgetExceeded = true;
        break;
      }
      const startedAt = Date.now();
      const actual = actualFor(await runScenario(scenario, mode), Date.now() - startedAt);
      cumulativeCost += actual.cost_usd;
      attempts.push({ pass: inspect || grade(actual, scenario.expected), actual });
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
  printTable(results, passes, budgetExceeded);
  console.log(`output: ${outputPath}`);

  const complete = results.length === scenarios.length && results.every((result) => result.attempts.length === passes);
  const passed = complete && results.every((result) => result.attempts.every((attempt) => attempt.pass));
  if (!inspect && !passed) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
