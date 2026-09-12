import type { HrisEvent } from "@/lib/types";

// Fourteen inbound events: twelve contract.signed, one exact replay of EVT-001 (same
// event_id, delivered again), and one start-date change for J-008. The replay is the
// idempotency test; it is not a bug in the data.

export const EVENTS: HrisEvent[] = [
  { event_id: "EVT-001", type: "contract.signed", occurred_at: "2026-09-25T10:14:05Z", joiner_id: "J-001", payload: { entity: "Quilstead Solutions UK Ltd" } },
  { event_id: "EVT-002", type: "contract.signed", occurred_at: "2026-09-26T08:40:12Z", joiner_id: "J-002", payload: { entity: "Quilstead Solutions GmbH" } },
  { event_id: "EVT-003", type: "contract.signed", occurred_at: "2026-09-22T16:05:30Z", joiner_id: "J-003", payload: { entity: "Quilstead Solutions Inc" } },
  { event_id: "EVT-001", type: "contract.signed", occurred_at: "2026-09-25T10:14:05Z", joiner_id: "J-001", payload: { entity: "Quilstead Solutions UK Ltd", redelivery: true } },
  { event_id: "EVT-004", type: "contract.signed", occurred_at: "2026-09-29T09:20:44Z", joiner_id: "J-004", payload: { entity: "Quilstead Solutions UK Ltd" } },
  { event_id: "EVT-005", type: "contract.signed", occurred_at: "2026-09-28T13:00:09Z", joiner_id: "J-005", payload: { entity: "Quilstead Solutions GmbH" } },
  { event_id: "EVT-006", type: "contract.signed", occurred_at: "2026-09-30T18:30:51Z", joiner_id: "J-006", payload: { entity: "Quilstead Solutions Inc" } },
  { event_id: "EVT-007", type: "contract.signed", occurred_at: "2026-09-30T11:45:03Z", joiner_id: "J-007", payload: { entity: "Quilstead Solutions UK Ltd" } },
  { event_id: "EVT-008", type: "contract.signed", occurred_at: "2026-09-27T20:10:22Z", joiner_id: "J-008", payload: { entity: "Quilstead Solutions Inc" } },
  { event_id: "EVT-009", type: "contract.signed", occurred_at: "2026-10-01T09:00:00Z", joiner_id: "J-009", payload: { entity: "Quilstead Solutions UK Ltd", employment_type: "contractor" } },
  { event_id: "EVT-010", type: "contract.signed", occurred_at: "2026-10-01T14:20:37Z", joiner_id: "J-010", payload: { entity: "Quilstead Solutions GmbH" } },
  { event_id: "EVT-011", type: "contract.signed", occurred_at: "2026-10-02T15:00:18Z", joiner_id: "J-011", payload: { entity: "Quilstead Solutions Inc" } },
  { event_id: "EVT-012", type: "contract.signed", occurred_at: "2026-10-02T17:30:41Z", joiner_id: "J-012", payload: { entity: "Quilstead Solutions UK Ltd" } },
  { event_id: "EVT-013", type: "joiner.start_date_changed", occurred_at: "2026-10-03T10:00:00Z", joiner_id: "J-008", payload: { previous_start_date: "2026-10-12", start_date: "2026-10-19", reason: "Visa appointment moved" } },
];
