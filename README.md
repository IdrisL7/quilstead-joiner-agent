# Athena for Quilstead: Day-one readiness

A deterministic prototype for one of Quilstead Solutions' onboarding pain points, built for the
Humaans Athena take-home. The agent turns a "contract signed" event into a compliant,
equipped, connected first morning without a person chasing every step.

Status: deterministic core hardening pass. Data pack, connectors, permission ladder,
trusted approval checks and prototype are in. Agent loop, approval queue and UI follow.
See `AGENTS.md` for the map.

## Run

```bash
npm install
npm test                        # vitest
npm run demo                    # one complete mock-mode event-to-send flow
npm run prototype -- --all      # every event through the state machine, no model call
npm run prototype -- J-002      # one joiner
```

## What is working, simulated, incomplete

| Item | Status |
|---|---|
| Deadlines, owners, compliance items per country (UK, US, DE) | Working, deterministic, tested |
| Idempotent event handling, start-date recompute | Working, tested |
| Permission ladder; no grant path; outbound messages gated on approval | Working, tested |
| Webhook HMAC verification, citation guard | Working, tested |
| HRIS, identity, equipment, Slack, email, e-sign, buddy directory, policy KB | Simulated adapters behind the production interface |
| One event-to-plan-to-draft-to-approved-send trace | Working in deterministic mock mode, tested |
| Full model loop, approval queue UI, general drafting | Incomplete |
| Case-view UI | Incomplete (Sunday) |
| Public holidays in working-day maths | Not modelled |

All people, companies, emails and policies are fictional.
