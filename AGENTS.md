# Map (read this first, then only what the task needs)

Athena for Quilstead: Day-one readiness. A take-home for Humaans. One case type: a new
joiner from "contract signed" to a compliant, equipped, connected first morning.

- `lib/types.ts` — the domain. Read the design notes at the top before touching anything.
- `lib/policy/` — deterministic rules: working days, country deadlines, buddy eligibility, access matrix. The model never computes a deadline.
- `lib/plan.ts` — joiner + now -> tasks, owners, policy-raised escalations. Pure.
- `lib/store/case-store.ts` — in-memory cases, idempotent on event_id, start-date recompute.
- `lib/connectors/` — one interface, simulated adapters. No grant action exists. Messaging adapters refuse unapproved drafts.
- `lib/permissions.ts` + `config/permissions.json` — the ladder. Unknown tool = prohibited.
- `lib/model.ts` — bounded nudge drafting. Mock mode is deterministic; live mode is opt-in and requires the Anthropic key.
- `lib/demo-flow.ts` + `app/api/demo/route.ts` — one in-memory model-assisted flow with a human approval boundary.
- `app/page.tsx` — minimal approval screen for that flow.
- `data/` — fictional Quilstead: joiners (12, with `demo_note` naming each edge case), people, buddies, events (one replay), inbox (one injection), `policy-kb/` (cited pages), `sops/` (skills the agent loads per country).
- `scripts/prototype.ts` — terminal state machine, no model. `npm run prototype -- --all`.
- `tests/` — vitest. `npm test`.

Not yet built: persistence, live connectors, general model loop, policy Q&A, and the full case-view UI.

Rules for anyone editing: no deadline in prose that code does not compute; no new tool without a permissions rule; `demo_note` never reaches a prompt.
