# Athena build explanation

## The flow in one line

```text
EVT-004 contract.signed
  -> CaseStore.open and deterministic plan
  -> equipment.order observation
  -> bounded agent loop: observe, propose or escalate, finish
  -> Drafts in trusted approval state
  -> People Partner decision
  -> simulated slack.send_message receipt
  -> buddy comparison -> exact buddy request approval -> labelled simulated response
  -> named People confirmation
  -> joiner.start_date_changed and current-state recomputation
```

## 1. What starts the workflow and where facts come from

The demo selects the existing `EVT-004` contract-signed event in `data/events.ts`. `CaseStore.open` creates `CASE-J-004`, writes the contract, builds the country-aware plan and assigns owners from the deterministic policy code in `lib/plan.ts`.

The equipment observation comes from the simulated `equipment.order` connector. It returns a backordered order with an ETA of 16 October. `buildDemoFacts` in `lib/demo-flow.ts` projects the current contract timestamp, equipment task deadline, owner, start date, ETA, calculated gap, risk flag and verbatim equipment policy quote. The UI and model receive the same current facts.

## 2. What deterministic code decides

- `lib/plan.ts` decides task deadlines, owners, status and policy escalations.
- `lib/store/case-store.ts` preserves the case identity and reconciles the existing tasks when a start-date event arrives.
- `lib/demo-flow.ts` decides whether the current ETA is late, whether a draft is needed and whether a superseded draft is still usable.
- `lib/connectors/simulated/messaging.ts` resolves the approved draft from trusted state. A caller cannot supply approval, recipient or free text to the send action.

The model does not calculate deadlines, choose recipients, grant access, approve a message or declare that an external outcome happened.

## 3. What the model decides

`lib/agent/loop.ts` owns the bounded Messages API tool-use loop. The model can choose which
allowed observation to request next, whether current evidence supports a pending equipment or
buddy proposal, whether an unresolved issue needs escalation, and the next human action. The
mock model in `lib/agent/mock-model.ts` is the golden state machine for this checkpoint. It makes
one deliberate prohibited `identity.grant_access` call so the Activity trace shows the permission
boundary, then continues to a finished run.

Every tool call passes through `authorize()` and the registered connector runtime. The loop caps
model steps, tool calls and elapsed time. `propose_message` is guarded by application code for
recipient allowlists, current availability, concrete equipment mitigation, trusted slots, date
evidence and length. `finish` only records the next human action. No tool can send a message,
grant access, write HRIS data or complete compliance work.

The current triggers are `contract.signed`, `start_date_changed`, `buddy_declined` and
`availability_changed`. A date change recomputes the case before the assistant runs. A declined
buddy or changed calendar re-reads the current comparison and can create a fresh pending request;
the old request remains history. A failed run leaves the current case installed with a visible
`Run assistant again` recovery action. Non-finished runs do not commit staged proposals.

The model proposes the recipient and wording. Code appends the two proposed buddy slots from the
latest availability observation, validates the proposal against the current facts and guardrails,
and leaves the draft for a named human to approve. Mock wording is deterministic for repeatable
evaluation; live wording is generated from the same observations. Both modes keep facts,
approval gates and connector permissions outside the model.

The buddy presentation uses the same current case facts and simulated calendar snapshot. Code ranks
policy-eligible candidates, calculates two non-overlapping first-week slots, shows up to three
comparisons and keeps the exact request in a separate preview. People approves the exact buddy draft
before the simulated send. A clearly labelled simulated response then records acceptance or decline;
acceptance alone never completes the task. Named People confirmation is the final buddy boundary.

The first-week calendar strip in the selected-candidate panel is a second view of the same
observation. The route projects the candidate's busy intervals for the joiner's first working week
from `data/buddy-calendars.ts` (only when the snapshot's `read_status` is `known`, only intervals in
that week, no titles or attendees because the fixture holds none), and the UI draws them beside the
proposed slots and the joiner's 09:30 Monday arrival. Unknown, error and out-of-coverage calendars
render as a labelled empty week with the same reason text the comparison shows. The agent's
`get_buddy_availability` observation is unchanged; the strip exists for the person approving, not for
the model. Confirmed slots turn green after People confirmation; a superseded or rejected request's
slots are not drawn.

Ask Athena is a read-only Slack-style surface over the same case. Its `question` run uses the same
bounded loop, but the tool definitions and runtime allow only current-state and policy reads plus
`finish`; proposal, escalation, approval, send and write tools are excluded in application code. The
mock router answers five case intents from current observations and labels each response `Mock
answer`. Live mode uses the Anthropic adapter with the same schemas and guards and labels the
response `Anthropic model`. Answer guards replace untrusted dates or names and cap the response at
600 characters. Code derives section links from the tools actually used, and one `agent.asked` step
is added to the case trail. The browser keeps the question history in memory only, so Reset clears
it and no persistence is introduced. The question is data, not an instruction, and cannot open a
second path to an approval story.

The attention summary is a projection of the current case, task, request and escalation state, not a
second readiness store. The trace records simulation inputs, connector observations, approvals,
responses and confirmation history.

## 4. Why the approval boundary is outside the model

Every outbound message is a registered `Draft` with a pending status. `approveDraft` and `rejectDraft` are trusted application functions called by the approval route. The connector checks the trusted approval snapshot again before sending and suppresses duplicate sends by action, channel and draft id.

The e-sign action has its own action and channel check, so an email approval cannot authorise an e-sign pack.

## 5. How People edits equipment wording

Only a pending equipment draft exposes `Edit`. People can change the subject and message,
while recipient, channel and evidence facts remain application-controlled. `Save` validates
the fields, creates a fresh draft and run id, supersedes the old pending version and records
`Edited by People`; it sends nothing. Approval then resolves that exact saved draft. A stale tab,
old draft id, superseded draft or non-pending draft is rejected. Buddy request state and history
remain separate, and a start-date change can supersede the pending edited draft.

## 6. Rejection, stale approval, model failure and a changed date

- Rejection records a human decision and the connector refuses the send.
- A new preparation or a start-date change rotates the active run id. An old tab receives a 409 and cannot approve the current draft.
- A start-date change supersedes any pending draft before updating the case. The case and HRIS snapshot then move together.
- If the assistant fails after that state change, `changeDemoStartDate` returns the updated case, updated joiner and current facts with `draft_unavailable`. The screen shows a clear recovery state, keeps the run active, offers `Run assistant again` for the same date and allows a different date to be recalculated. No message is approvable in that state.
- A successful date change to 19 October removes the late-arrival risk because the unchanged 16 October ETA is now earlier than first day. A date such as 9 October keeps the risk and can produce a fresh draft.
- A simulated calendar change marks the selected buddy's availability unknown, refreshes the comparison and invalidates an affected request. Decline recovery offers another pending candidate request without automatically sending a replacement.

The recovery defect fixed in checkpoint C was a partial transition: the old implementation mutated the case before drafting, then returned the old preparation facts when drafting failed. The new preparation is built from the mutated case and current joiner state before it is installed as the active run.

## 7. What is simulated, tested live and still unknown

Simulated: HRIS state, in-memory case storage, equipment response, policy files, mock agent model, Slack send and receipts. Live Anthropic wording uses the same simulated observations; no persistence or live connector is included.

Verified in this workspace: mock flow, approval refusal and approval, stale-run rejection, duplicate suppression, start-date recomputation, evidence projection, missing-key drafting failure recovery, editable equipment draft exactness, bounded trigger recovery, the 20-scenario mock golden set at 20/20 pass^3, the same 20 scenarios live on `claude-haiku-4-5-20251001` at 20/20 pass^3 with zero terminal-state flapping (USD 0.027 per run, 2026-09-13), typecheck, lint and production build. Real Slack delivery, IT response, persistence and production latency under load remain unknown.

## 8. Code and AI assistance disclosure

The implementation reuses the existing `CaseStore`, plan builder, simulated connectors, permission ladder, policy files, bounded agent runtime and approval state functions. Codex applied the bounded checkpoint changes and added focused regression coverage in this branch. The customer flow does not claim that a human reviewed every line or that live integrations were exercised.
