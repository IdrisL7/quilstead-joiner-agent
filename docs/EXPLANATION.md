# Athena build explanation

## The flow in one line

```text
EVT-004 contract.signed
  -> CaseStore.open and deterministic plan
  -> equipment.order observation
  -> bounded model nudge
  -> Draft in trusted approval state
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

## 3. What the model contributes

`lib/model.ts` receives the joiner facts, equipment result, equipment task and owner name. In mock mode it produces deterministic subject and body text. In live mode the Anthropic adapter is bounded to a 15-second timeout, zero SDK retries and a strict JSON shape check. The requested action must mention a loaner or earlier delivery.

The spoken distinction is: **“This mock run uses a fixed draft; the live adapter generates wording from the same facts.”** Both modes keep the facts, approval gate and connector permissions outside the model.

The live adapter was verified once through the local API. It returned HTTP 200 from Anthropic
using `claude-haiku-4-5-20251001`, with a pending draft body, `before_approval: denied` and
trace entries for `model.draft` and `send.refused`. This proves bounded adapter wiring and the
approval hold for one run. It does not prove production reliability or live message delivery.

The buddy presentation uses the same current case facts and simulated calendar snapshot. Code ranks
policy-eligible candidates, calculates two non-overlapping first-week slots, shows up to three
comparisons and keeps the exact request in a separate preview. People approves the exact buddy draft
before the simulated send. A clearly labelled simulated response then records acceptance or decline;
acceptance alone never completes the task. Named People confirmation is the final buddy boundary.

The spoken distinction is: **“This mock run uses a fixed draft; the live adapter generates wording from the same facts.”**
The buddy request itself is deliberately fixed in this mock checkpoint and is not described as live AI
output. The attention summary is a projection of the current case, task, request and escalation state,
not a second readiness store. The trace records simulation inputs, connector observations, approvals,
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
- If drafting fails after that state change, `changeDemoStartDate` returns the updated case, updated joiner and current facts with `draft_unavailable`. The screen shows a clear recovery state, keeps the run active, offers `Retry draft` for the same date and allows a different date to be recalculated. No message is approvable in that state.
- A successful date change to 19 October removes the late-arrival risk because the unchanged 16 October ETA is now earlier than first day. A date such as 9 October keeps the risk and can produce a fresh draft.
- A simulated calendar change marks the selected buddy's availability unknown, refreshes the comparison and invalidates an affected request. Decline recovery offers another candidate without automatically sending a replacement.

The recovery defect fixed in checkpoint C was a partial transition: the old implementation mutated the case before drafting, then returned the old preparation facts when drafting failed. The new preparation is built from the mutated case and current joiner state before it is installed as the active run.

## 7. What is simulated, tested live and still unknown

Simulated: HRIS state, in-memory case storage, equipment response, policy files, model mock, Slack send and receipts. No persistence or live connector is included.

Verified in this workspace: mock flow, approval refusal and approval, stale-run rejection, duplicate suppression, start-date recomputation, evidence projection, missing-key drafting failure recovery, editable equipment draft exactness, typecheck, lint and production build. One local Anthropic draft-generation run also passed with approval held. Production latency, provider availability, real Slack delivery and IT response remain unknown.

## 8. Code and AI assistance disclosure

The implementation reuses the existing `CaseStore`, plan builder, simulated connectors, permission ladder, policy files, model adapter and approval state functions. Codex applied the bounded checkpoint changes and added focused regression coverage in this branch. The customer flow does not claim that a human reviewed every line or that live integrations were exercised.
