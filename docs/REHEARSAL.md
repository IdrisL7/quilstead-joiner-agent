# Athena rehearsal

This is the customer-facing rehearsal for the bounded day-one readiness flow. It uses fictional Quilstead data and mock systems only.

## Before starting

Run:

```bash
npm run dev
```

Open `http://localhost:3000`. Keep the browser at a laptop-sized viewport for the main rehearsal. The narrow layout keeps the `SIMULATED / NO LIVE SEND` badge visible and is useful for a final readability check.

The live Anthropic path is not part of this rehearsal. Credentials remain unresolved and live execution is not verified.

## 15-minute customer run-of-show

| Time | Action | Point to make |
|---|---|---|
| 0:00-1:00 | Set the scene | Athena watches a contract-signed event and looks for one day-one risk. The case is Aisha Okafor, London, hybrid, starting 12 October. |
| 1:00-2:30 | Click `Generate model nudge` | The event opens `CASE-J-004`. The deterministic plan creates 14 tasks, then the simulated equipment connector reports an ETA of 16 October. |
| 2:30-4:00 | Read the timeline | Contract, equipment task deadline, first day and delivery ETA are current application facts. The 4-day gap is calculated from the dates. Nadia Hussain is the IT owner. |
| 4:00-5:30 | Expand `Why this?` | Show the start date, ETA, task deadline, owner, exact equipment policy quote and the human approval requirement. Distinguish source facts from generated wording. |
| 5:30-7:00 | Review the draft | The model contributes a concise request for a loaner or earlier delivery. It does not choose the recipient, dates, permission or approval state. |
| 7:00-8:30 | Click `Approve and send` | The simulated Slack action runs only after the People Partner decision. The result says `Sent with approval. Awaiting IT response.` It does not claim the laptop problem is solved. |
| 8:30-9:30 | Review `ATTENTION SUMMARY` and `BUDDY SUPPORT` | Candidate cards separate eligibility, current assignments, calendar status and proposed slots. The recommendation is an application decision, not a model guess. |
| 9:30-10:30 | Click `Request Ewan Grant`, then `Approve exact request` | The request preview is the exact fixed mock draft and commitment that the People Partner approves. No message is sent while it is pending. |
| 10:30-11:30 | Use `Simulate buddy accepts`, then `Confirm allocation as People` | Acceptance is explicitly simulated and remains separate from People confirmation. Only the named People action completes the buddy task. |
| 11:30-12:30 | Reset, click `Simulate Ewan Grant unavailable` | The current calendar snapshot changes to unknown, the comparison recommends Amara instead, and the trace records the simulation. Affected requests are invalidated. |
| 12:30-13:30 | Optional recovery: prepare Amara, or simulate a decline | A decline is labelled as a simulation and offers another candidate. No replacement request is sent automatically. |
| 13:30-15:00 | Change the start date to 19 October and close on boundaries | The same case remains active, deadlines recompute and the chronological timeline updates. People owns approvals and confirmation, IT owns the equipment response, and calendars remain mock read-only snapshots. |

## What to avoid saying

- Do not say the equipment was delivered or that IT accepted the request. The receipt only confirms the simulated send.
- Do not describe this as a general autonomous agent or a full onboarding dashboard.
- Do not imply that the model calculated deadlines or selected a recipient.
- Do not claim live Anthropic execution. It remains not run.
- Say explicitly: “This mock run uses a fixed draft; the live adapter generates wording from the same facts.”

## Rehearsal checkpoints

The visible sequence should be:

```text
contract signed -> deterministic plan -> equipment observation -> model draft
-> evidence -> human approval -> simulated Slack receipt -> current-state date change
```

If a click fails, stop the customer demonstration and use the trace and test output to explain the boundary. Do not improvise a second workflow.
