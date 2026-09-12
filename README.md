# Athena for Quilstead: Day-one readiness

A deterministic prototype for one of Quilstead Solutions' onboarding pain points, built for the
Humaans Athena take-home. The agent turns a "contract signed" event into a compliant,
equipped, connected first morning without a person chasing every step.

Status: feature batch complete. Data pack, connectors, permission ladder, trusted approval
checks, one model-assisted flow, current-state timeline, evidence panel, recoverable start-date
interaction, editable equipment drafts, browser polish and rehearsal materials are in.
One local live Anthropic draft was verified. The customer flow remains mock-first.
Persistence, live integrations and broader orchestration remain deferred.
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

The approval screen defaults to a deterministic mock model. Set `DEMO_MODE=live` and provide
`ANTHROPIC_API_KEY` to use the bounded Anthropic drafting path. The draft is still held until a
human approves or rejects it, and the send remains simulated. This checkout has one successful
live draft-generation probe; it does not claim live delivery or production reliability.

## What is working, simulated, incomplete

| Item | Status |
|---|---|
| Deadlines, owners, compliance items per country (UK, US, DE) | Working, deterministic, tested |
| Idempotent event handling, start-date recompute | Working, tested |
| Permission ladder; no grant path; outbound messages gated on approval | Working, tested |
| Webhook HMAC verification, citation guard | Working, tested |
| HRIS, identity, equipment, Slack, email, e-sign, buddy directory, policy KB | Simulated adapters behind the production interface |
| One model-assisted event-to-plan-to-draft trace | Working in mock mode; one local live Anthropic draft verified |
| Minimal approval screen with approve/reject boundary | Working in mock mode, browser-verified; live draft held for approval |
| Editable equipment draft with exact saved-wording approval | Working, tested and browser-verified |
| Buddy candidate comparison, exact request preview and People confirmation | Working in mock mode, browser-verified; calendar responses are labelled simulations |
| Equipment, buddy and compliance attention summary | Working from current case state, browser-verified |
| Current timeline, evidence panel and start-date interaction | Working in mock mode, browser-verified |
| Draft failure recovery after a date change | Working, tested with missing-key mode |
| Live Anthropic execution | One local draft-generation run verified; live delivery not exercised |
| Persistence, live integrations, general model loop, policy Q&A | Deferred |
| Broader case-view UI | Deferred |
| Public holidays in working-day maths | Not modelled |

All people, companies, emails and policies are fictional.
