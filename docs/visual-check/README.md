# Visual redesign check, 2026-09-12

Presentation pass only: `app/page.tsx`, `app/globals.css`, `app/icon.svg`, `public/humaans-wordmark-*.svg`. No change to `lib/`, `app/api/`, data or tests.

Commands, run serially after the change: `npm test` 62 passed (9 files), `npm run typecheck` clean, `npm run lint` clean, `npm run build` clean, `npm run demo` approval = approved / send before approval = denied / send after approval = ok / retry = duplicate suppressed, `npm run prototype -- --all` 12 cases.

Browser checks ran headless in Chrome (playwright-core) at 1440x900 and 390x844 against `next dev`:

| Check | Result |
|---|---|
| Prepare, switch sections, return to pending equipment draft unchanged | pass |
| Reject, recover through reset and prepare | pass |
| Approve; receipt stays in the same panel; no second approve path | pass |
| Compare buddies; selecting a row prepares nothing; prepare, approve, simulate accept, confirm as People as three separate steps | pass |
| Decline path shows "no replacement sent automatically" | pass |
| Offer another candidate after decline | pass (verified by reviewer): declining Ewan brings Amara into the top three; her replacement request was prepared, approved and confirmed |
| Availability change supersedes the approved request | pass |
| Start date to 19 Oct: equipment risk cleared, "No message needed", timeline chronological, compliance row updated, pending buddy request superseded | pass |
| Draft-unavailable and API-conflict states | not triggered in the browser; covered by existing tests (`tests/page.test.ts`, `tests/demo-route.test.ts`) |
| Horizontal overflow at 1440 and 390 | none |
| Console errors | none after adding `app/icon.svg` (favicon 404 before) |
| Keyboard order | nav, start date, recalculate, demo controls, candidate rows, actions; `:focus-visible` outline on all controls, white outline in the sidebar independent of the indigo selection marker |
| Simulation label visible on desktop and mobile | yes |

Captures: `01-overview.png`, `02-equipment-pending.png`, `07-buddy-request-pending.png`, `14-equipment-after-date-change.png` (desktop 1440), `21-mobile-overview.png` (390). Live Anthropic execution was not part of this pass.
