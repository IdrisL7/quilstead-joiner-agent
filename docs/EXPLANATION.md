# Why I built it this way

I chose onboarding because the consequences are easy to see. Someone can have a signed contract and a completed checklist, then arrive without a laptop, a buddy who has time, or a confirmed plan for the morning.

My interpretation of Quilstead's problem was that People still has to connect information across owners and systems. I built around that coordination work. In a real engagement, I would check that diagnosis with the team before treating it as the cause.

## What I prioritised

Equipment came first. A delivery date after the start date gives the agent a clear problem, an owner and a useful next step: ask IT for a loaner or earlier delivery. It also gives the customer something concrete to review.

Buddy availability mattered to me because I have been through onboarding where the person assigned to help was too busy. Eligibility alone does not solve that. The demo checks capacity and calendar slots, then asks the buddy to accept. People confirms the allocation afterwards. A free calendar slot does not prove someone is willing or able to help.

I added access requests and manager coordination to cover more of the first-day handoffs. Access follows a role matrix and stops at a submitted request with a named approver. The manager supplies arrival details, which only become confirmed facts after People reviews them.

Equipment monitoring removes one repeated manual check. Once a case is open, the server watches for supplier changes and prepares a new action when needed. I kept monitoring limited to equipment so I could test the full path, including stale work and failures.

I chose a conversation as the entry point. A readiness question shows the full picture; a specific question shows the relevant work. Calendar comparisons, source facts and the activity trail remain available when someone needs to inspect the reasoning.

I left profile editing, real integrations and persistence out of this build. The profile view makes the missing setup task visible, but does not pretend to complete it. Adding more write operations would need more validation than I could demonstrate here.

## How a case runs

A contract-signed fixture event, or the first supported question, opens the case. Code creates tasks, calculates dates and gathers initial observations. The model does not choose every part of that setup.

The bounded loop then gives the model a case goal, instructions and permitted tools. In live mode it chooses what to check next, whether to propose a message, an allowed recipient, wording, an escalation or a next action. Each trigger limits the work it can do.

Code validates the result before registering a pending draft. People can edit the wording and approve the exact saved version. The messaging connector checks that approval again before sending. A changed date, supplier observation or draft can make an earlier approval stale.

The response and the outcome stay separate. Sending a message to IT does not mean the laptop is sorted. Buddy acceptance is followed by People confirmation. A manager's reply is reviewed before it becomes a confirmed first-day plan.

## Code, model and human decisions

| Responsibility | Who owns it |
|---|---|
| Dates, owners, equipment lateness, buddy eligibility, capacity and slots | Deterministic application rules |
| Tool permissions, role access, proposal validation and stale-version checks | Application code |
| Which permitted observation to request, what to propose and how to word it | The live model, within the trigger's instructions |
| Message approval, buddy willingness and final allocation or plan confirmation | People and the named participants |
| Supplier updates, calendar changes and replies | External inputs, simulated in this build |

I kept exact rules in code because they have answers that can be tested directly. A model does not need to calculate whether 9 October is after a 5 October start. Its role is to use the observations to choose and explain a permitted next step.

The live model's output can vary. Temperature zero does not guarantee identical wording or tool choices. Mock mode uses fixed responses and is useful for repeatable workflow tests; it is not evidence of fresh model reasoning.

Ask Athena uses read-only tools once a case is open. A first question can open a case and run its initial checks. An explicit date-change request still needs the separate confirmation action. Filing access requests is permitted only within the relevant workflow and role rules. There is no access-grant action.

## Background monitoring and recovery

One server-side monitor checks opened cases on chained 15-second ticks. It compares supplier signatures and revisions. An unchanged observation creates no new agent run, draft or notification.

A changed observation triggers equipment reassessment. Before accepting the result, code checks the supplier source, case revision and reset generation again. That prevents an older result from replacing newer state. The browser polls read-only snapshots to display progress; it does not drive the scheduler.

The monitor continues while the browser is closed, provided the server stays running. It creates in-app alerts, not administrator emails or push notifications. Alerts can draw attention to another case without switching the user's view. Reviewing or dismissing an alert leaves the approval decision unchanged.

The loop has caps of eight model steps and twelve tool calls, a 60-second run budget and a 15-second model-call timeout. The SDK has no automatic retries; the live adapter separately allows one retry for rate-limit or overload responses. These limits bound the demo's work and cost. They do not guarantee production response times.

Monitoring has a six-invocation session ceiling and a two-attempt limit for a failed observation. Case state is in memory, so a server restart loses progress. A production service would need durable state and recovery before it could promise continued monitoring.

## How I used AI and checked the output

I used AI coding assistants to produce most of the implementation and regression tests. My role was to set the scope, question the behavior, direct revisions and check the evidence. I do not claim to have manually written or reviewed every line.

I worked incrementally through fictional data, deterministic rules, simulated connectors, approval controls, the model loop and the customer interface. I used separate QA passes to challenge the result through tests, HTTP requests and browser interactions.

One useful failure involved a supplier update arriving while People edited a manager message. The update changed the case version, so Save could fail or navigation could hide the editor. The repair preserved the wording and allowed a newer case version only when the exact pending manager request and draft still matched. The server continued to reject stale work.

Later QA found a malformed approval request that opened the default case instead of rejecting the request. It did not send anything, but it was still the wrong behavior. Validation now rejects it before any case or monitor starts. I also corrected status messages that made saved edits look unsaved or described a failed draft as requiring no action.

The [evaluation report](evals/README.md) separates the current mock results from earlier live-model evidence. Neither the tests nor the evaluation establish reliability on unseen customer data. Live verification of the latest access, manager and monitoring paths is still outstanding.

## Value I would measure

The demo catches a late laptop, prepares a request, identifies buddies with time, files permitted access requests and records a confirmed first-day plan. It also reacts to a supplier change without another manual check.

I expect that to reduce checking and chasing, but I have not measured customer time savings. For a pilot I would compare People effort per joiner, unresolved blockers before day one, and how often proposals are accepted, edited or rejected. I would also measure detection delay, failed-action recovery, API cost and human review time. An approval queue that takes as much work as the old process would not be a useful result.

## Before a real build

I would start with People, managers, buddies and IT to map the handoffs. Which failures recur? Who owns each step? What evidence counts as ready? Can buddies decline, and how is their capacity measured?

Next I would agree which systems are authoritative and check their APIs, events and sandbox access. A supplier receipt, an access request and a completed delivery mean different things. The integration needs to preserve those distinctions.

Security and privacy owners would need to agree what employee and calendar data the service can read, what may reach the model, who can approve each action, and how long records are retained. The policies and country rules in this repository are fictional examples, not a substitute for that discovery.

## Before pilot and launch

I would require authenticated identities and case-level permissions, durable cases and approvals, recoverable work after a restart, and coordination between workers. Retries must reconcile ambiguous sends so a lost acknowledgement does not produce a second message.

Real connector tests would cover duplicates, out-of-order events, rate limits, missing records, partial failures and revoked access. Policy tests would include public holidays, timezone changes, contractors, leave and incomplete calendars. Deterministic code can still be consistently wrong if its inputs or policy rules are wrong.

I would test the current live model on held-out cases and untrusted inputs, including instructions hidden in messages or documents. Evaluation needs to check recipients, dates and actions as well as readable prose. Prompt, tool, policy and model changes should trigger another evaluation.

I would agree an operational owner, failure alerts, spending limits, a pause control and a manual fallback. Then I would start in a sandbox, compare results in a read-only shadow run, and pilot proposals with a small supervised group. Expansion should follow the evidence from that pilot.
