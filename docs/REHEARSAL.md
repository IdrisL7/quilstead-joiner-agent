# Athena rehearsal

This is the customer-facing rehearsal for the bounded day-one readiness flow. It uses fictional
Quilstead data and mock systems only.

## Before starting

Run:

```bash
DEMO_MODE=mock npm run dev
```

Open `http://localhost:3000` at a laptop-sized viewport. Keep the `SIMULATED / NO LIVE SEND`
badge visible. The real Anthropic probe is not part of this browser rehearsal.

## Ten-minute walkthrough

| Time | Action | Point to make |
|---|---|---|
| 0:00-0:45 | Click `Simulate contract signed` | The visible event opens Aisha's case. Deterministic code creates the plan and the simulated equipment connector reports an ETA of 16 October against the 12 October start. |
| 0:45-1:30 | Stay on `Overview` and read the timeline | The timeline is built from current case facts. The initial execution summary is historical and does not rewrite itself after later approval or date changes. |
| 1:30-2:30 | Open `Equipment`, then expand `Why this action` | Show the start date, ETA, task deadline, owner, policy evidence and the approval requirement. Code calculates the risk; the model contributes a bounded proposal. |
| 2:30-3:30 | Open `Activity` and read the trace | Point to the deliberate prohibited access call, the visible guard refusal and the later finished step. Then show the corresponding permission rule in `config/permissions.json`. |
| 3:30-4:30 | Approve the equipment draft | People approves the exact pending draft. The simulated Slack receipt means only that the request was sent by the demo; it does not mean IT accepted it. |
| 4:30-6:00 | Click `Reset`, then `Simulate contract signed`; open `Buddy support`. Ewan is already selected with a pending request the assistant proposed. Point at the first-week strip. | Reset and trigger are separate demo controls. Say: eligibility is policy, capacity is a count, availability is the calendar, and here is the calendar. Grey is busy, the two purple blocks are the only commitment we ask Ewan for, the red line is Aisha arriving 09:30 Monday. Read-only snapshot, simulated. Click Sam Rowe: the strip shows "Calendar not read" rather than guessing. Selecting a row sends nothing. |
| 6:00-7:00 | Click `Approve` for the exact Ewan request, then `Simulate buddy declines` | Buddy acceptance is a simulated response after approval. The decline triggers the assistant again: it re-reads availability without Ewan, proposes Amara, and her strip replaces his. Nothing is sent automatically. |
| 7:00-8:00 | Change the start date to 19 October and recalculate | Deadlines and risk are recomputed from current state. The chronological timeline changes, and the compliance next action remains the actual open compliance task. |
| 8:00-9:15 | Point to `docs/evals/README.md` | Say: "All 20 evaluation scenarios passed three times. Eighteen exercised the live model; two tested contractor rejection. Expected outcomes stayed consistent across those passes." Then the two qualifications: the scenarios guided development, so this is repeatability on the development set, not unseen-case reliability; and the report verifies recorded API costs (USD 0.027 per run), not the account's total spend. Then the run-by-run table: first live run 2/20, every miss classified and fixed in the contract, the guard or the harness. |
| 9:15-10:00 | Close on boundaries and the case Activity ledger | The case trail stays complete even though the UI trace is thinned. People owns approvals and confirmation, IT owns the equipment response, calendars are read-only snapshots drawn from busy intervals with no meeting titles, and no tool can send without approval. |

## Spoken model distinction

Say explicitly: “This mock run uses a fixed draft; the live adapter generates wording from the same
facts.” The mock model is deterministic so the golden set can be repeated. The live adapter uses
the same loop, tool schemas and guards, but its wording and tool choices require a real provider
run before they can be described as measured.

## Recovery lines

- If the assistant is unavailable, point to `Draft unavailable`, keep the current case facts visible,
  and click `Run assistant again`. No draft is approvable while the run is unavailable.
- If the start date changes to 9 October, explain that the equipment risk remains and a new draft
  can be prepared. If drafting fails, the case and returned facts still use the requested date.
- If a stale tab tries to approve, explain that the old run or draft is rejected and the current
  pending version must be reviewed.
- If a buddy becomes unavailable, show that the confirmed buddy remains the simulation target until
  the changed availability is recorded, then explain that the request is superseded and another
  candidate can be proposed.

## What to avoid saying

- Do not say the equipment was delivered or that IT accepted the request. The receipt only confirms
  the simulated send.
- Do not describe this as a general autonomous agent or a full onboarding dashboard.
- Do not imply that the model calculated deadlines, selected an ineligible recipient or completed a
  compliance task.
- Do not call the calendar strip an integration. It draws the simulated snapshot's busy intervals for
  the first working week; the model never sees the strip, only the availability observation.
- Do not claim live Slack delivery, a real IT response or production reliability. Live reliability is
  measured on a 20-scenario golden set, not on a customer cohort; say that.

## Technical explanation order

When asked how it works, use this order:

1. `lib/agent/loop.ts`: bounded steps, tool calls, timeout, retries and commit-on-finish.
2. `config/permissions.json`: every tool call is authorized, including the visible refusal.
3. `lib/agent/guards.ts`: recipients, dates, slots, message purpose and approval boundaries are
   checked in application code.
4. `docs/evals/README.md`: the measured mock table, price source, cost boundary and failure
   classification.
5. The case trail and `Activity`: complete evidence remains available even when presentation rows
   are reduced to the decisions a reviewer needs.

The correct close is: one bounded mock flow, one fake-client verification of the Anthropic adapter,
and a clearly stated live-provider gap. Persistence, live integrations and broader orchestration
remain deferred.
