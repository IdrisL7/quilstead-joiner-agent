// Terminal prototype of the case state machine. Throwaway by design: it answers "does
// the joiner lifecycle feel right" before any UI exists.
//
//   npm run prototype -- J-002            one joiner
//   npm run prototype -- --all            every event in order, including the replay
//   npm run prototype -- --today 2026-10-03T09:00:00Z --all
//
// No model is called. Everything printed comes from policy code and the data pack.

import { EVENTS } from "@/data/events";
import { joinerById } from "@/data/joiners";
import { personById } from "@/data/people";
import { CaseStore } from "@/lib/store/case-store";
import { resetDemoState } from "@/lib/store/demo-state";
import type { Case } from "@/lib/types";

const args = process.argv.slice(2);
const todayIdx = args.indexOf("--today");
const NOW = todayIdx >= 0 ? args[todayIdx + 1] : "2026-09-30T09:00:00Z";
const all = args.includes("--all");
const wanted = args.filter((a) => /^J-\d{3}$/.test(a));

resetDemoState();
const store = new CaseStore();

function printCase(c: Case) {
  const j = joinerById(c.joiner_id)!;
  console.log(`\n== ${c.id}  ${j.full_name}  ${j.title}  ${j.country}/${j.office}/${j.work_mode}  start ${c.start_date}  state: ${c.state.toUpperCase()}`);
  const contract = store.contracts.get(c.id);
  if (contract) console.log(`   goal: ${contract.goal}`);
  if (c.tasks.length) {
    console.log("   tasks:");
    for (const t of c.tasks) {
      const owner = personById(t.owner_id);
      const flag = t.compliance_code ? ` [${t.compliance_code}]` : "";
      console.log(`     ${t.status.padEnd(9)} ${t.due_at.slice(0, 10)}  ${t.type.padEnd(30)} ${(owner?.full_name ?? t.owner_id).padEnd(16)} ${t.title}${flag}`);
    }
  }
  if (c.escalations.length) {
    console.log("   escalations:");
    for (const e of c.escalations) console.log(`     ${e.severity.padEnd(8)} ${e.code.padEnd(24)} -> ${e.to_function}${e.resolved_at ? " (resolved)" : ""}: ${e.summary}`);
  }
  console.log(`   steps: ${c.steps.map((s) => s.kind).join(" -> ")}`);
}

const events = all ? EVENTS : EVENTS.filter((e) => wanted.includes(e.joiner_id));
if (events.length === 0) {
  console.log("Usage: npm run prototype -- J-001 [J-002 ...] | --all  [--today ISO]");
  process.exit(1);
}

console.log(`today = ${NOW}`);
for (const e of events) {
  const j = joinerById(e.joiner_id);
  if (e.type === "contract.signed") {
    const r = store.open(e, j, NOW);
    console.log(`\n>> ${e.event_id} ${e.type} ${e.joiner_id}: ${r.outcome}${r.reason ? ` (${r.reason})` : ""}`);
    if (r.case && r.outcome !== "duplicate") printCase(r.case);
    else if (r.case) console.log(`   last step: ${r.case.steps.at(-1)?.summary}`);
  } else if (e.type === "joiner.start_date_changed" && j) {
    const r = store.applyStartDateChange(e, j, NOW);
    console.log(`\n>> ${e.event_id} ${e.type} ${e.joiner_id}: ${r.deadlineChanged} deadlines moved, ${r.changed} tasks reconciled, ${r.unchanged} unchanged, ${r.added} added`);
    if (r.case) printCase(r.case);
  }
}

const cases = store.list();
console.log(`\n${cases.length} cases. states: ${cases.map((c) => `${c.id}=${c.state}`).join(", ")}`);
