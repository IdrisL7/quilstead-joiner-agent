# Athena for Quilstead: Day-one readiness

A working AI agent for one of Quilstead Solutions' onboarding pain points, built for the
Humaans Athena take-home. The agent turns a "contract signed" event into a compliant,
equipped, connected first morning without a person chasing every step.

Status: Friday scaffold. Deterministic core, data pack, connectors, permission ladder and
prototype are in. Agent loop, approvals and UI follow. See `AGENTS.md` for the map.

## Run

```bash
npm install
npm test                        # vitest
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
| Agent loop, trail, approval queue, drafting | Incomplete (Saturday) |
| Case-view UI | Incomplete (Sunday) |
| Public holidays in working-day maths | Not modelled |

All people, companies, emails and policies are fictional.
