# Athena rehearsal

This is the customer-facing rehearsal for the bounded day-one readiness flow. It uses fictional Quilstead data and mock systems only.

## Before starting

Run:

```bash
DEMO_MODE=mock npm run dev
```

Open `http://localhost:3000`. Keep the browser at a laptop-sized viewport for the main rehearsal. The narrow layout keeps the `SIMULATED / NO LIVE SEND` badge visible and is useful for a final readability check.

This customer flow stays in mock mode. One separate local live probe generated a draft through Anthropic,
but no live delivery was exercised. Keep that distinction explicit.

## 15-minute customer run-of-show

| Time | Action | Point to make |
|---|---|---|
| 0:00-1:00 | Set the scene | Athena watches a contract-signed event and looks for one day-one risk. The case is Aisha Okafor, London, hybrid, starting 12 October. |
| 1:00-2:00 | Click `Simulate contract signed` | The event opens `CASE-J-004`. The deterministic plan creates 14 tasks, then the simulated equipment connector reports an ETA of 16 October. |
| 2:00-3:00 | Open `Overview`; read `Initial onboarding checks completed` and the timeline | The initial summary is historical. Current approval, send and date status belong in `Needs attention`; the timeline uses current facts. |
| 3:00-4:00 | Open `Equipment`, then expand `Why this action` | Show the start date, ETA, task deadline, owner, exact equipment policy quote and human approval requirement. Distinguish source facts from generated wording. |
| 4:00-5:30 | Click `Edit draft`, change wording, then `Cancel` | Only subject and message are editable. Cancel restores the pending draft and sends nothing. Recipient, channel and evidence remain application-controlled. |
| 5:30-7:00 | Edit again and click `Save changes` | Saving creates a fresh pending revision, invalidates the old version and shows `Edited by People`. Approval is still required. |
| 7:00-8:00 | Click `Approve and send` | The simulated Slack action uses exactly the saved wording. Result: `Sent with approval. Awaiting IT response.` It does not claim the laptop problem is solved. |
| 8:00-10:00 | Open `Buddy support`, prepare Ewan, approve exact request, accept and confirm | The request preview is the exact fixed mock draft. Simulated buddy acceptance remains separate from `Confirm allocation as People`. |
| 10:00-11:00 | Click `Simulate Ewan Grant unavailable` | The confirmed buddy remains the target. Availability becomes unknown, the request is superseded and Amara is offered. The trace records the simulated response. |
| 11:00-12:00 | Use `Reset and prepare again`, open `Buddy support`, click `Prepare request for Ewan`, then `Approve exact request` and `Simulate buddy declines` | The decline control appears only after the exact request is approved and sent. Decline is labelled simulated and offers recovery. No replacement request is sent automatically. |
| 12:00-13:30 | Change the start date to 19 October and click `Recalculate case` | The same case remains active, deadlines recompute, the chronological timeline updates and the compliance next action stays tied to the real compliance task. |
| 13:30-15:00 | Open `Activity`, read the trace and close on boundaries | People owns approvals and confirmation, IT owns the equipment response, calendars remain mock read-only snapshots, and one live Anthropic draft probe does not equal live integration proof. |

## What to avoid saying

- Do not say the equipment was delivered or that IT accepted the request. The receipt only confirms the simulated send.
- Do not describe this as a general autonomous agent or a full onboarding dashboard.
- Do not imply that the model calculated deadlines or selected a recipient.
- Do not claim live Slack delivery, a real IT response or production reliability. One local Anthropic draft-generation probe passed, but live delivery was not exercised.
- Do not describe the one live draft probe as a complete live integration.
- Say explicitly: “This mock run uses a fixed draft; the live adapter generates wording from the same facts.”

## Rehearsal checkpoints

The visible sequence should be:

```text
contract signed -> deterministic plan -> equipment observation -> model draft
-> evidence -> human approval -> simulated Slack receipt -> current-state date change
```

If a click fails, stop the customer demonstration and use the trace and test output to explain the boundary. Do not improvise a second workflow.
