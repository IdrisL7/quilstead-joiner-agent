# Agent evaluation report

Date: 2026-09-13

The same 20 golden scenarios were run three times in mock mode. The mock model is deliberately
deterministic, so this measures the loop, tools, guards, state commit and evaluation harness rather
than provider variance.

Pricing was verified on 2026-09-13 against the [official Claude pricing page](https://platform.claude.com/docs/en/about-claude/pricing): Claude Haiku 4.5 is listed at $1 per million input tokens and $5 per million output tokens. The adapter uses those list prices for `cost_usd`. No prompt-cache claim is made and no `cache_control` field is sent because this bounded prefix is not padded to the Haiku cache threshold.

## Measured result

| | Mock Haiku-shaped run | Live Anthropic run |
|---|---:|---:|
| scenarios | 20 | NOT RUN |
| passes | 3 | NOT RUN |
| pass@3 | 20/20 | NOT RUN |
| pass^3 | 20/20 | NOT RUN |
| flapping | 0 | NOT RUN |
| mean cost per run | $0.000000 | NOT RUN |
| mean tool calls | 5.40 | NOT RUN |
| mean wall time | 1 ms | NOT RUN |

The live run was not attempted because `ANTHROPIC_API_KEY` was not configured in the workspace.
No provider spend, live wording result or live reliability number is inferred from the mock run.

## Scenario table

| Scenario | Result | Stop reason | Flapping |
|---|---:|---|:---:|
| contract-j001 | 3/3 | finished | no |
| contract-j002 | 3/3 | finished | no |
| contract-j003 | 3/3 | finished | no |
| contract-j004 | 3/3 | finished | no |
| contract-j005 | 3/3 | finished | no |
| contract-j006 | 3/3 | finished | no |
| contract-j007 | 3/3 | finished | no |
| contract-j008 | 3/3 | finished | no |
| contract-j009 | 3/3 | no run, rejected | no |
| contract-j010 | 3/3 | finished | no |
| contract-j011 | 3/3 | finished | no |
| contract-j012 | 3/3 | finished | no |
| date-j004-19 | 3/3 | finished | no |
| date-j004-09 | 3/3 | finished | no |
| decline-j004-ewan | 3/3 | finished | no |
| availability-j004-ewan | 3/3 | finished | no |
| track-j004 | 3/3 | finished | no |
| contract-j002-repeat | 3/3 | finished | no |
| contract-j005-repeat | 3/3 | finished | no |
| contract-j009-repeat | 3/3 | no run, rejected | no |

## Three sentences for the panel

- Reliability: the mock golden set passed all 20 scenarios on all three passes, with no terminal-state flapping.
- Cost: mock mode makes no provider calls and measured $0.000000 per run; live cost per joiner is not measured yet.
- Harness learning: an early report treated variable wall time as flapping, so the harness now compares terminal outcomes separately from measurement-only fields and reports zero flapping.

## Reproduce

```bash
npx tsx scripts/evals.ts --mode mock --passes 3 --out docs/evals/2026-09-13-mock.json
npx tsx scripts/evals.ts --mode live --passes 3 --out docs/evals/2026-09-13-live.json
```

The live command is intentionally not run until the key is configured and the provider call is
explicitly authorized. The script stops when cumulative estimated cost reaches the USD 2.00 cap.
