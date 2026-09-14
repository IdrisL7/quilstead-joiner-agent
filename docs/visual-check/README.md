# Visual checks

## Redesign pass, 2026-09-12

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

Captures: `01-overview.png`, `02-equipment-pending.png`, `07-buddy-request-pending.png`, `14-equipment-after-date-change.png` (desktop 1440), `21-mobile-overview.png` (390). At that date the live Anthropic browser probe had not been run; the fake-client adapter test is covered by the local suite.

## Calendar strip and Ask Athena, 2026-09-13

Captures: `calendar-strip-ewan-desktop.png`, `calendar-strip-confirmed-desktop.png`, `calendar-strip-ewan-mobile.png`, `ask-athena-desktop.png`, `ask-athena-mobile.png`, `ask-entry-desktop.png`. Mock mode, same headless Chrome method. The live model was exercised the same day through `scripts/evals.ts` (`docs/evals/README.md`), not through the browser.

## Adversarial QA before submission, 2026-09-14

Commands: `npm test` 118 passed (12 files), `npm run typecheck` clean, `npm run lint` clean, `npm run build` clean, mock golden set 20/20 pass^3.

Method: an API fuzz of every `/api/demo` action in valid and invalid sequences (malformed bodies, stale runs, decisions out of order, impossible dates, repeated confirmations, availability changes on a confirmed buddy, parallel requests); a headless browser run of the reviewer's sequence (approve, ask, change the date from chat, decline, ask, accept, confirm, ask, simulate unavailable, reset, reload mid-case) at 1440 and 390; forty-plus realistic Ask Athena phrasings through the intent router and the answer guards; seven live-model questions; and an audit of every number and claim in the documents against the code and the committed eval files.

Fixed from that pass: the `Next:` banner and the chat kept repeating the assistant's original recommendation after a person had acted; start-date changes accepted impossible dates, weekends and dates before the case clock; five input paths returned 500 instead of 400; invalidating a confirmed buddy leaked the capacity reservation and the case buddy id; an idempotent re-run appended its trace rows twice; a rejected nudge was described as needing review; a declined buddy with no replacement claimed one had been prepared; the mock router missed common phrasings (`status`, `what's outstanding`, `when does she start`, `has Ewan replied`) and matched substrings (`details` as `eta`); the chat date parser turned negations and questions into a change card and could not read ordinals; the buddy answer presented a superseded request as the buddy; the name guard rejected the joiner's own title and real colleagues; the invented-date guard accepted the wall-clock date. Documentation numbers were recomputed from the committed eval files.

Known and left as is (in the README ledger): one in-memory case per process, no authentication, approver fixed to `pp-1`, fixed case clock for facts and wall clock for run timestamps, no rate limit on the route.
