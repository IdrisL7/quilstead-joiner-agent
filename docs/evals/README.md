# Agent evaluation

I used a set of fictional onboarding scenarios to check whether the agent reached the expected outcome. The saved reports contain each attempt, its observed actions and any grading failures. The scenarios are in [data/golden/cases.json](../../data/golden/cases.json), and the runner is [scripts/evals.ts](../../scripts/evals.ts).

## Saved results

| Measure | Mock, 15 September 2026 | Live, 13 September 2026 |
|---|---:|---:|
| Scenarios | 23 | 20 |
| Attempts per scenario | 3 | 3 |
| Scenarios passing all three attempts | 23 | 20 |
| Executed agent runs | 63 | 54 |
| Scenarios with different terminal states across attempts | 0 | 0 |
| Recorded model cost | USD 0 | USD 1.48 |

Sources: [current mock report](2026-09-15-mock.json) and [earlier live report](2026-09-13-live.json). The [earlier mock report](2026-09-13-mock.json) is retained for comparison with that live run.

There are fewer executed runs than attempts because two contractor scenarios reject the case before invoking the agent. In the live report, eighteen scenario types exercised `claude-haiku-4-5-20251001`, producing 54 model-backed runs across three passes.

Those live runs averaged about USD 0.027 and 12.3 seconds each. I recalculated these figures over executed runs only. The runner's printed averages include rejected attempts, so they are lower. Cost is an estimate from recorded token usage and the rates encoded for that run. It is not an account billing reconciliation or a production cost forecast.

The live report predates access requests, manager coordination and equipment monitoring. The current mock set covers those triggers, but their live paths have not been verified by this report.

## What the grading checks

Both modes check whether a run happened, the expected stop reason and the terminal case state.

Mock grading compares proposal kinds, recipients and escalation codes with the fixture, and checks the expected next-action prefix. That checks the scripted path and its integration with the application.

Live grading requires the expected proposals and escalations. It allows extra nudge proposals and two additional escalation codes, `OWNER_SLA_BREACHED` and `COMPLIANCE_DEADLINE_AT_RISK`. Runtime guards remain responsible for validating those nudges against case owners and evidence. The grader also checks that a required next action exists and is no longer than 240 characters. It does not independently verify every word of the response.

`pass@3` means a scenario passed at least once in three attempts. `pass^3` means it passed all three. Flapping measures a change in terminal case state, not a change in wording or tool order.

## What I learned

The early runs exposed gaps in the tool contracts and guards. Recipients needed explicit rules, escalation codes needed an allowed set, and date validation needed to recognise equivalent date formats. A superseded draft also needed to be distinguishable from a human rejection so the model could interpret a changed date correctly.

I used those failures to revise the implementation. That means this is a development set, not an independent test set. The saved final reports support repeatability on these scenarios; they do not establish reliability on unseen customer cases. Earlier intermediate runs were not retained as complete JSON reports.

Before a pilot I would run the current live build on held-out scenarios, review action and recipient correctness, and compare its proposals with People handling the same cases. I would also test missing data, prompt injection, connector failures and changes during approval.

## Run the evaluation

From the repository root:

```bash
npx tsx scripts/evals.ts --mode mock --passes 3 --out /tmp/athena-mock-evaluation.json
```

For live evaluation, make `ANTHROPIC_API_KEY` available in the process environment. This command incurs API costs:

```bash
npx tsx scripts/evals.ts --mode live --passes 3 --pace-ms 4000 --budget-usd 5 --out /tmp/athena-live-evaluation.json
```

Use `--only date-j004-09,decline-j004-ewan` to select a subset. The runner checks its recorded spending between attempts and uses `--pace-ms` to space attempts. The budget is a runner control, not a provider-side spending cap.

These commands use the current scenario file. They do not recreate the older code revision behind the 13 September reports. Output goes to a separate file so the saved evidence is not overwritten.
