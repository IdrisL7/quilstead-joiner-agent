# Athena for Quilstead

I built an onboarding agent for the work between a signed contract and someone's first day. It helps the People team spot gaps, prepare the next action and follow changes without repeatedly checking each system.

I started with late equipment and buddy availability, then added access requests, manager coordination and background equipment monitoring. The demo uses fictional people and simulated systems. A sent request is recorded as progress, not proof that the underlying problem is solved.

## Run the demo

Use Node.js 20.9 or newer. From the repository root:

```bash
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). Mock mode needs no API key. Choose **Check Aisha's onboarding readiness** to start, or select Priya from the joiner menu.

The workspace represents Sarah Mitchell in the People team. You can edit and approve the equipment message, arrange buddy support, submit role-based access requests and confirm a manager's first-day plan. Profile details are available to view; profile editing is not built.

To see background monitoring, open Priya's case, choose **Demo controls**, then **Simulate supplier delay**. Switch back to Aisha. The server checks supplier updates every 15 seconds and prepares a proposal when it detects the change. The browser displays it on its next refresh. Reviewing or dismissing the alert clears it without approving a message.

Keep the server running during the demo. Restarting it clears the cases, approvals and notifications. **Reset all demo cases** also clears both joiners and resets the monitor's session limit.

## Where the model fits

In live mode, the model chooses permitted tool calls, proposes wording and an allowed recipient, or escalates a problem. Code calculates dates, eligibility and risk, checks permissions and validates each proposal. People approves the exact message before a simulated send.

Mock mode uses scripted model responses. The scheduler, case updates and approval checks still run, but the wording and tool choices are scripted.

For live drafting, configure these values in a local, git-ignored `.env.local` file:

| Setting | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Your local Anthropic credential |
| `DEMO_MODE=live` | Use the live model for foreground work |
| `EQUIPMENT_MONITOR_MODE=live` | Separately enable live equipment reassessment |
| `ANTHROPIC_MODEL` | Optional model override; the default is `claude-haiku-4-5-20251001` |

Live mode incurs API costs. Both modes use simulated external systems and require message approval.

## What works and what is missing

| Area | Current behavior |
|---|---|
| Equipment | Detects late delivery, prepares editable requests and rejects stale approvals. Background monitoring can prepare a new proposal or clear the risk. |
| Buddy support | Checks eligibility, capacity and calendar slots. Contact approval, buddy acceptance and People confirmation are separate. |
| Access | Files role-permitted requests with receipts and named approvers. It cannot grant access. |
| Manager coordination | Supports editable requests, exact approval, a simulated reply and separate confirmation of first-day arrangements. |
| Case questions and changes | Aisha and Priya retain separate state. Answers use case facts. Date changes require confirmation and invalidate affected plans. |
| External systems | HRIS, equipment, identity, calendars and messaging are all simulated. The displayed People identity is not authenticated. |
| Production gaps | No durable persistence, real integrations, public-holiday rules or multi-process coordination. General policy Q&A and profile editing are deferred. |

Only equipment has continuous monitoring. It covers opened cases in one process, with a six-reassessment session limit and two attempts per failed observation.

## Verification

The recorded 15 September checks passed 209 tests across 18 files, typecheck, lint and the production build. The CLI demo refused sending before approval and suppressed a duplicate retry. The prototype processed 12 cases. Browser QA exercised edits, approvals, case isolation, date changes, stale supplier recovery and monitoring with the browser closed.

The saved mock evaluation passed all 23 scenarios three times. The earlier live evaluation passed all 20 scenarios three times on 13 September. Eighteen of those scenarios exercised the model; two rejected contractors before a model run. That live result predates the access, manager and monitor additions. It does not establish their live reliability.

These scenarios also guided development. I have not measured performance on unseen customer cases or customer time savings. See the [evaluation report](docs/evals/README.md) for grading, results and limits.

Representative captures:

- [Chat-first entry](docs/visual-check/botanical-welcome-desktop.png)
- [Prepared work and approval](docs/visual-check/customer-conversation-desktop.png)
- [Buddy calendar evidence](docs/visual-check/customer-calendar-desktop.png)
- [Access requests](docs/visual-check/scenarios-access-desktop.png)
- [Narrow layout](docs/visual-check/perspective-entry-mobile.png)

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run demo
npm run prototype -- --all
npx tsx scripts/evals.ts --mode mock --passes 3 --out /tmp/athena-mock-evaluation.json
```

The [build explanation](docs/EXPLANATION.md) covers my priorities, use of AI and what I would validate before deployment. [AGENTS.md](AGENTS.md) is the codebase map.
