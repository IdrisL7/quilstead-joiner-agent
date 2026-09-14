# Map (read this first, then only what the task needs)

Athena for Quilstead: Day-one readiness. A take-home for Humaans. One case type: a new
joiner from "contract signed" to a compliant, equipped, connected first morning.

- `lib/types.ts` — the domain. Read the design notes at the top before touching anything.
- `lib/policy/` — deterministic rules: working days, country deadlines, buddy eligibility and first-week availability, access matrix. The model never computes a deadline.
- `lib/plan.ts` — joiner + now -> tasks, owners, policy-raised escalations. Pure.
- `lib/store/case-store.ts` — in-memory cases, idempotent on event_id, start-date recompute.
- `lib/connectors/` — one interface, simulated adapters. No grant action exists. Messaging adapters refuse unapproved drafts.
- `lib/permissions.ts` + `config/permissions.json` — the ladder. Unknown tool = prohibited.
- `lib/agent/` — the bounded agent: `loop.ts` (Messages API tool-use loop, caps, idempotent runs), `tools.ts` (eight tools, `authorize()` on every call), `guards.ts` (recipients, dates, slots, wording), `mock-model.ts` (scripted golden path), `live-model.ts` (Anthropic adapter), `ask.ts` + `mock-ask.ts` (Ask Athena: same loop, read-only allowlist).
- `lib/attention.ts` — equipment, buddy and compliance attention from current case state; the source of the next action once a person has acted.
- `lib/demo-flow.ts` + `app/api/demo/route.ts` — one in-memory case flow with human approval boundaries, date changes, buddy requests and Ask Athena. One active run per process.
- `app/page.tsx` — the case workspace: Overview, Equipment, Buddy support (with the first-week calendar strip), Activity, Ask Athena.
- `lib/model.ts` — legacy single-call nudge wording helper; only its type is still imported. The live path is `lib/agent/live-model.ts`.
- `data/` — fictional Quilstead: joiners (12, with `demo_note` naming each edge case), people, buddies, buddy calendars, events (one replay), inbox (one injection), `policy-kb/` (cited pages), `sops/` (skills the agent loads per country), `golden/cases.json` (20 eval scenarios).
- `scripts/evals.ts` — golden-set harness (`--mode mock|live --passes n --out file`); reports in `docs/evals/`.
- `scripts/prototype.ts` — terminal state machine, no model. `npm run prototype -- --all`.
- `tests/` — vitest. `npm test`.

Not built: persistence, live connectors, authentication, a policy Q&A intent in the mock router, and a multi-case UI.

Rules for anyone editing: no deadline in prose that code does not compute; no new tool without a permissions rule; `demo_note` never reaches a prompt; no number in the docs that was not measured.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
