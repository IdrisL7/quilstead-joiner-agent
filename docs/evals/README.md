# Agent evaluation report

Date: 2026-09-13. Model: `claude-haiku-4-5-20251001`. Golden set: `data/golden/cases.json`, 20 scenarios
(12 joiners on `contract.signed`, plus start-date change to 19 Oct and to 9 Oct, buddy decline, buddy
availability change, equipment on track, and three repeats). Harness: `scripts/evals.ts`.

Pricing verified on 2026-09-13 against the [official Claude pricing page](https://platform.claude.com/docs/en/about-claude/pricing):
Haiku 4.5 at USD 1 per million input tokens and USD 5 per million output tokens. `cost_usd` uses those
list prices from the `usage` block of each response. No `cache_control` is sent: the system prefix
(two SOP files plus the task contract, about 2.5 KB of text) is estimated, not measured, to sit below
the 4,096-token minimum Haiku needs for caching, so a cache claim would be a no-op.

## Final measured result

| | Mock (scripted golden path) | Live Anthropic |
|---|---:|---:|
| scenarios × passes | 20 × 3 | 20 × 3 |
| pass@3 (capability) | 20/20 | 20/20 |
| pass^3 (reliability: all three passes correct) | 20/20 | 20/20 |
| flapping (terminal state differs across passes) | 0 | 0 |
| executed runs (contractor scenarios reject before any run) | 54 | 54 |
| mean model turns per run | 5.9 | 4.8 |
| mean tool calls per run | 6.0 | 5.4 |
| mean guard refusals per run | 0.78 (1.0 on the 42 `contract.signed` runs, where the mock makes its deliberate `identity.grant_access` call; 0 on the other triggers) | 0.24 |
| mean input / output tokens per run | 0 | 22,898 / 889 |
| mean cost per executed run | USD 0 | USD 0.027 |
| total cost of the run | USD 0 | USD 1.48 |
| mean wall time per run | 2 ms | 12.3 s |

Source files: `2026-09-13-mock.json`, `2026-09-13-live.json`. Every mean above is over the 54 executed
runs, recomputed from those files on 2026-09-14. The harness's own printed means divide by all 60
attempts, including the six contractor attempts that never run, so it prints lower figures for the
same data (live: 4.9 tool calls, USD 0.0246, 11.0 s).

Grading. Mock grades the exact golden wording of `next_action`. Live grades structure: run happened,
stop reason `finished`, every expected proposal (kind and recipient) present, every expected escalation
present, terminal case state, and a one-sentence `next_action` under 240 characters (the tool asks the
model for under 200; the runtime and the grader enforce 240). The live model may
add work the SOP asks for that the mock does not do: a nudge to another open-task owner, or an
`OWNER_SLA_BREACHED` / `COMPLIANCE_DEADLINE_AT_RISK` escalation. In the final run it added 12 nudges
to People partners about overdue HRIS profiles and 3 `OWNER_SLA_BREACHED` escalations. Anything else
extra, or anything expected but missing, is a miss. Flapping compares terminal state only; wording is
the model's and varies by design.

## How the live number was earned, run by run

| Run | Result | What was wrong | Fix (all structural, no prompt adjectives) |
|---|---:|---|---|
| 1, three passes | 2/20 | Escalation code invented (`NO_AVAILABLE_BUDDY`): schema had no enum. Buddy request sent to a People partner: tool contract never said which id goes in `to`. `12 October` refused while `2026-10-12` was in the facts: string-token date guard. Model ended with text instead of `finish`. Then the API credit balance ran out mid-run. | `bad_tool_contract`: escalation enum, recipient rule in descriptions and system prompt, optional `reason`/`evidence`. `weak_guard`: every date form normalised to ISO. Loop: one reminder turn, then implicit finish if something was proposed. Rate limit: one retry on 429/529. |
| 2, one pass | 11/20 | Guards contradicted the SOP the model was given: nudges to overdue HRIS owners refused (guard allowed only the equipment owner); task deadlines the model had just been shown refused as invented dates; candidates with unknown availability requested; long multi-sentence `next_action`. | `missing_guardrail` inverted: nudge may go to any open-task owner, loaner rule only for the late-laptop nudge; all shown deadlines allowed; availability rule stated in the tool and prompt; `finish` collapses to one sentence; three refusals per kind before stopping. Harness: fixtures set up with the mock, live grading on structure. |
| 3, one pass | 20/20 | | |
| 4, three passes | 19/20, flapping 5 | `date-j004-09` 1/3: after a date change the superseded nudge showed as `rejected`, so the model read a fact change as a People decision and skipped `check_equipment`. Flapping counted wording. | `missing_context`: superseded drafts labelled `superseded` with the reason; `check_equipment` reports `nudge_needed` and a hint; each trigger carries an instruction. Flapping on terminal state only. Re-run of the four fact-change scenarios: 12/12. |
| 5, three passes | **20/20, flapping 0** | | Final. |

Every miss became a clearer map, a better tool contract, a stricter or corrected guard, or a new
expected value. No miss was fixed by re-running until it passed.

## Scenario table, final live run

| Scenario | Result | Stop reason | Next action (model's words, one example) |
|---|---:|---|---|
| contract-j001 | 3/3 | finished | Sarah Mitchell must verify buddy availability or arrange support by hand, and complete the overdue HRIS profile and right-to-work check. |
| contract-j002 | 3/3 | finished | Resolve the critical right-to-work escalation and verify buddy availability for the three eligible Berlin candidates. |
| contract-j003 | 3/3 | finished | Approve the pending HRIS nudge to Jordan Alvarez and resolve the buddy escalation by verifying candidate availability or arranging support by hand. |
| contract-j004 | 3/3 | finished | Approve the pending nudge to Nadia Hussain about the late laptop and the buddy request to Ewan Grant. |
| contract-j005 | 3/3 | finished | Approve the pending HRIS profile nudge to Sarah Mitchell and review the buddy escalation for manual arrangement. |
| contract-j006 | 3/3 | finished | Verify buddy availability with eligible candidates or arrange support by hand; all other tasks are on track for Dan's start on 2026-10-12. |
| contract-j007 | 3/3 | finished | Approve the pending buddy request to Ewan Grant (b-06) for Tom's onboarding starting 2026-10-12. |
| contract-j008 | 3/3 | finished | Approve the pending nudge to Jordan Alvarez about the overdue HRIS profile, and resolve the buddy escalation. |
| contract-j009 | 3/3 | no run, rejected | none (contractor, out of scope) |
| contract-j010 | 3/3 | finished | Sarah Mitchell must verify buddy calendar availability for Max Richter, Tim Schulz or Lea Hoffmann, or arrange buddy support by hand. |
| contract-j011 | 3/3 | finished | Verify buddy availability with eligible candidates and confirm allocation by 2026-10-14, or arrange support by hand. |
| contract-j012 | 3/3 | finished | Approve the pending buddy request to Rob Fletcher for Ollie's onboarding. |
| date-j004-19 | 3/3 | finished | Approve the pending buddy request to Rob Fletcher for Aisha's onboarding on 2026-10-19. |
| date-j004-09 | 3/3 | finished | Approve the pending nudge to IT (equipment loaner/earlier delivery) and buddy request to Rob Fletcher (b-02). |
| decline-j004-ewan | 3/3 | finished | Approve the pending buddy request to Amara Osei (b-01) for Aisha's onboarding. |
| availability-j004-ewan | 3/3 | finished | Approve the pending buddy request to Amara Osei. |
| track-j004 | 3/3 | finished | Approve the pending buddy request to Ewan Grant and monitor right-to-work evidence by 2026-10-09. |
| contract-j002-repeat | 3/3 | finished | Resolve the critical right-to-work escalation and verify buddy availability for the three eligible Berlin candidates. |
| contract-j005-repeat | 3/3 | finished | Approve the pending nudge to Sarah Mitchell about the overdue HRIS profile. |
| contract-j009-repeat | 3/3 | no run, rejected | none |

## Panel wording

"All 20 evaluation scenarios passed three times. Eighteen exercised the live model; two tested
contractor rejection. Expected outcomes stayed consistent across those passes."

Two qualifications, said in the same breath:

- These scenarios also guided development. The number demonstrates repeatability on the development
  set, not reliability on unseen cases. Unseen-case reliability comes from a shadow run on a real
  cohort, which has not happened.
- The report verifies recorded API costs from each response's `usage` block (USD 0.027 per executed
  run, USD 1.48 for the final run). It does not reconcile the account's total spend for the day
  across the five runs and reruns; only the final run's output file was kept, so runs 1 to 4 in the
  table above are recorded from their console output, not reproducible from this repository.

Supporting lines if asked:

- Cost at scale: about 23k input tokens across five tool calls per run; at 30 joiners a week with three
  triggers each, roughly USD 2.50 a week before any caching.
- Harness learning: the first live run scored 2/20; every miss was classified and fixed in the tool
  contract, the guards or the harness, never by re-running until it passed, and two of the fixes were
  guards that contradicted the SOP the model had been told to follow.

## Reproduce

```bash
npx tsx scripts/evals.ts --mode mock --passes 3 --out docs/evals/2026-09-13-mock.json
DEMO_MODE=live npx tsx scripts/evals.ts --mode live --passes 3 --pace-ms 4000 --budget-usd 5 --out docs/evals/2026-09-13-live.json
# a subset: --only date-j004-09,decline-j004-ewan
```

Live needs `ANTHROPIC_API_KEY`. The script stops at `--budget-usd` (default USD 2) and spaces runs by
`--pace-ms` to stay under the input-token rate limit.
