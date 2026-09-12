import { runDemo } from "@/lib/demo-flow";

async function main() {
  const run = await runDemo();

  console.log(`case = ${run.case.id} (${run.joiner.full_name})`);
  console.log(`equipment = ${run.equipment.summary}`);
  console.log(`draft = ${run.draft.id} (${run.draft.status}, ${run.draft.action})`);
  console.log("trace:");
  for (const step of run.trace) console.log(`  ${step.actor.padEnd(6)} ${step.kind.padEnd(22)} ${step.summary}`);
  console.log(`approval = ${run.approved ? "approved" : "not approved"}`);
  console.log(`send before approval = ${run.beforeApproval.status}`);
  console.log(`send after approval = ${run.afterApproval.status}`);
  console.log(`retry = ${run.retry.summary}`);
}

void main();
