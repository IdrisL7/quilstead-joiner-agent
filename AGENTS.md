# Codebase map

This is an onboarding demo for Quilstead. The UI supports Aisha and Priya; the fixture pack covers 12 joiners. External systems and the People identity are simulated. Case state is in memory.

## Where to look

| Path | Responsibility |
|---|---|
| `lib/types.ts` | Domain types and design notes |
| `lib/policy/`, `lib/plan.ts` | Dates, owners, equipment risk, buddy rules and the role access matrix |
| `lib/store/case-store.ts`, `lib/store/demo-session.ts` | Case state, current runs, revision checks and the shared mutation lock |
| `lib/connectors/` | Simulated systems and connector contracts |
| `lib/permissions.ts`, `config/permissions.json` | Tool permissions; unknown tools are prohibited |
| `lib/agent/` | Bounded loop, tools, proposal guards, mock and live adapters, read-only case questions |
| `lib/demo-flow.ts`, `app/api/demo/route.ts` | Case opening, approvals, edits, date changes and recovery |
| `lib/monitor/equipment-monitor.ts` | Equipment-only background monitoring |
| `lib/attention.ts`, `lib/onboarding-view.ts` | Current status and next actions |
| `app/page.tsx`, `app/components/` | Conversation, workflow cards and detail views |
| `data/` | Fictional joiners, events, policies, SOPs, calendars and 23 evaluation scenarios |
| `scripts/evals.ts` | Mock and live evaluation runner |
| `tests/` | Vitest coverage |

`lib/model.ts` is the legacy single-call wording helper. The active live adapter is `lib/agent/live-model.ts`.

## Boundaries to preserve

- Keep date calculations and permissions in code. Model wording must use validated case facts.
- Add a permission rule for any new tool. There is no access-grant action.
- Sending requires approval of the exact registered draft. Buddy acceptance and People confirmation remain separate.
- Preserve case isolation, stale-run rejection, source revalidation and duplicate suppression.
- Do not put fixture `demo_note` fields into prompts.
- Keep claims about verification tied to recorded results. Distinguish mock coverage from live-model coverage.

Persistence, authentication, live integrations, general policy Q&A and profile editing are not implemented. The monitor runs in one process.

## Verify changes

Run from the repository root:

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run demo
npm run prototype -- --all
```

For loop or tool changes, also run the mock evaluation described in [docs/evals/README.md](docs/evals/README.md). Check changed interactions in the browser. Passing unit tests alone does not establish that a user can complete the flow.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
