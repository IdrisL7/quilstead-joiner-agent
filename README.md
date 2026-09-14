# Athena for Quilstead: Day-one readiness

A working, bounded AI agent for one of Quilstead Solutions' onboarding pain points, built for the
Humaans Athena take-home. The agent turns a "contract signed" event into a compliant,
equipped, connected first morning without a person chasing every step.

Status: bounded agent loop, verified. Mock golden set 20/20 pass^3. Live Anthropic
(`claude-haiku-4-5-20251001`): all 20 evaluation scenarios passed three times, eighteen exercising the
live model and two testing contractor rejection, USD 0.027 per case run, measured 2026-09-13
(`docs/evals/README.md`). The scenarios also guided development, so this is repeatability on the
development set, not unseen-case reliability. The model chooses what to check, what to
propose and to whom; code owns every date, permission and send; a named person approves. Persistence
and live integrations remain deferred; every connector is simulated behind its production interface.
See `AGENTS.md` for the map.

## Run

```bash
npm install
npm test                        # vitest
npm run demo                    # one complete mock-mode event-to-send flow
npm run dev                     # minimal approval screen at localhost:3000
npm run prototype -- --all      # every event through the state machine, no model call
npm run prototype -- J-002      # one joiner
```

Rehearsal and build explanation: `docs/REHEARSAL.md` and `docs/EXPLANATION.md`.

The approval screen defaults to a deterministic mock model. `DEMO_MODE=live` selects the bounded
Anthropic tool-use adapter when a key is configured. Environment: `DEMO_MODE` (`mock`, default, or
`live`), `ANTHROPIC_API_KEY` (live only), `ANTHROPIC_MODEL` (live only, default
`claude-haiku-4-5-20251001`); put them in `.env.local`, which is git-ignored. In either mode, the draft is held until a
human approves or rejects it, and the send remains simulated. No live delivery or production
reliability is claimed here.

## What is working, simulated, incomplete

| Item | Status |
|---|---|
| Deadlines, owners, compliance items per country (UK, US, DE) | Working, deterministic, tested |
| Idempotent event handling, start-date recompute | Working, tested |
| Permission ladder; no grant path; outbound messages gated on approval | Working, tested |
| Webhook HMAC SHA-256 verify function, citation guard | Unit-tested; the demo event path replays unsigned fixture events and does not call the verify function |
| HRIS, identity, equipment, Slack, email, e-sign, buddy directory, policy KB | Simulated adapters behind the production interface |
| Bounded model-assisted loop and mock golden flow | Working; 20 golden scenarios pass^3 in mock mode, with contract, date, decline and availability triggers covered |
| Ask Athena case chat | Working; six grounded intents (status, equipment, buddy, compliance, owner, start date), section links, answer guards, `agent.asked` trail. Read-only once a case is open. The entry question with no case open runs the same flow as `Simulate contract signed` and says so in its answer. A start-date request in chat produces a confirmation card that calls the same date-change action; chat text never changes the case by itself. Mock answers are templated; live answers are the model, USD 0.006 mean over 7 questions measured 2026-09-14 |
| Minimal approval screen with approve/reject boundary | Working in mock mode, browser-verified; live draft held for approval |
| Editable equipment draft with exact saved-wording approval | Working, tested and browser-verified |
| Buddy candidate comparison, exact request preview and People confirmation | Working in mock mode, browser-verified; calendar responses are labelled simulations |
| Equipment, buddy and compliance attention summary | Working from current case state, browser-verified |
| Current timeline, evidence panel and start-date interaction | Working in mock mode, browser-verified |
| Draft failure recovery after a date change | Working, tested with missing-key mode |
| Live Anthropic execution | Working: same loop, tools and guards; 20 scenarios x 3 passes at 20/20, USD 0.027 per run (`docs/evals/README.md`) |
| Persistence, live integrations, broader orchestration, policy Q&A | Deferred |
| Broader case-view UI | Deferred |
| Public holidays in working-day maths | Not modelled |
| One case per server process | The demo holds a single in-memory active run; a second browser gets a stale-run 409 on mutations and recovers with `Reset` |
| Authentication and the approver's identity | None; the approving People partner is fixed to `pp-1` in the route |
| Clock | Case facts use a fixed case clock (30 September 2026); agent run and Ask Athena timestamps use the wall clock. Start dates must be working days on or after the case clock |
| Rate limiting on `/api/demo` | None; in live mode anyone who can reach the port can spend API credit |

All people, companies, emails and policies are fictional.
