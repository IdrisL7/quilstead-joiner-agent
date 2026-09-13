# Athena for Quilstead: Day-one readiness

A deterministic prototype for one of Quilstead Solutions' onboarding pain points, built for the
Humaans Athena take-home. The agent turns a "contract signed" event into a compliant,
equipped, connected first morning without a person chasing every step.

Status: Checkpoint C mock golden set is 20/20 pass^3 across three passes. The bounded Anthropic
adapter and fake-client guard test are in; the real live probe remains NOT RUN because this
workspace has no `ANTHROPIC_API_KEY` configured. Persistence, live integrations and broader
orchestration remain deferred.
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
Anthropic tool-use adapter when a key is configured. In either mode, the draft is held until a
human approves or rejects it, and the send remains simulated. No live delivery or production
reliability is claimed here.

## What is working, simulated, incomplete

| Item | Status |
|---|---|
| Deadlines, owners, compliance items per country (UK, US, DE) | Working, deterministic, tested |
| Idempotent event handling, start-date recompute | Working, tested |
| Permission ladder; no grant path; outbound messages gated on approval | Working, tested |
| Webhook HMAC verification, citation guard | Working, tested |
| HRIS, identity, equipment, Slack, email, e-sign, buddy directory, policy KB | Simulated adapters behind the production interface |
| Bounded model-assisted loop and mock golden flow | Working; 20 golden scenarios pass^3 in mock mode, with contract, date, decline and availability triggers covered |
| Minimal approval screen with approve/reject boundary | Working in mock mode, browser-verified; live draft held for approval |
| Editable equipment draft with exact saved-wording approval | Working, tested and browser-verified |
| Buddy candidate comparison, exact request preview and People confirmation | Working in mock mode, browser-verified; calendar responses are labelled simulations |
| Equipment, buddy and compliance attention summary | Working from current case state, browser-verified |
| Current timeline, evidence panel and start-date interaction | Working in mock mode, browser-verified |
| Draft failure recovery after a date change | Working, tested with missing-key mode |
| Live Anthropic execution | Adapter implemented and fake-client verified; real provider run NOT RUN because the key is unavailable |
| Persistence, live integrations, broader orchestration, policy Q&A | Deferred |
| Broader case-view UI | Deferred |
| Public holidays in working-day maths | Not modelled |

All people, companies, emails and policies are fictional.
