import type { Connector } from "../interface";
import { ok, failed } from "../interface";
import { addWorkingDays } from "@/lib/policy/dates";
import { createHash } from "node:crypto";

// Simulated equipment ordering. `LATE_FOR` makes specific joiners' orders miss their
// SLA so the nudge path can be shown on purpose (J-004).

export const LATE_FOR = new Set(["J-004"]);

export interface EquipmentOrder {
  id: string;
  joiner_id: string;
  model: string;
  ship_to: "office" | "home";
  status: "ordered" | "backordered";
  eta: string;
  source_revision: number;
  updated_at: string;
}

export interface EquipmentSourceObservation {
  order_id: string;
  joiner_id: string;
  status: EquipmentOrder["status"];
  eta: string;
  source_revision: number;
  signature: string;
}

export const orders: EquipmentOrder[] = [];

export const resetEquipmentState = (): void => {
  orders.length = 0;
};

export function equipmentSourceObservation(order: EquipmentOrder): EquipmentSourceObservation {
  return {
    order_id: order.id,
    joiner_id: order.joiner_id,
    status: order.status,
    eta: order.eta,
    source_revision: order.source_revision,
    signature: createHash("sha256").update(JSON.stringify({ id: order.id, eta: order.eta, status: order.status })).digest("hex"),
  };
}

function orderResult(order: EquipmentOrder) {
  const observation = equipmentSourceObservation(order);
  return order.status === "backordered"
    ? { status: "warning" as const, summary: `Order ${order.id} backordered; ETA ${order.eta} is after the SLA.`, data: { ...order, ...observation }, next_actions: ["Draft nudge to IT owner for approval"] }
    : ok(`Order ${order.id} placed; ETA ${order.eta}.`, { ...order, ...observation });
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export const equipment: Connector = {
  name: "equipment",
  description: "Orders laptops from the equipment policy.",
  simulated: true,
  production_target: "Jira Service Management or ServiceNow hardware request via API.",
  actions: {
    order: {
      description: "Place an order for the joiner's laptop. Returns order id, status and ETA.",
      schema: { joiner_id: "string", model: "string", ship_to: "office|home", now: "iso datetime" },
      run: async ({ joiner_id, model, ship_to, now }) => {
        if (!joiner_id || !model) return failed("Missing joiner or model");
        const existing = orders.find((candidate) => candidate.joiner_id === String(joiner_id));
        if (existing) return orderResult(existing);
        const late = LATE_FOR.has(String(joiner_id));
        const eta = addWorkingDays(String(now).slice(0, 10), late ? 12 : 3);
        const id = `EQ-${String(orders.length + 1).padStart(4, "0")}`;
        orders.push({ id, joiner_id: String(joiner_id), model: String(model), ship_to: ship_to === "home" ? "home" : "office", status: late ? "backordered" : "ordered", eta, source_revision: 1, updated_at: String(now) });
        return orderResult(orders.at(-1)!);
      },
    },
    get_order: {
      description: "Read the current laptop order for a joiner. Never creates or changes an order.",
      schema: { joiner_id: "string" },
      run: async ({ joiner_id }) => {
        const order = [...orders].reverse().find((candidate) => candidate.joiner_id === String(joiner_id));
        if (!order) return failed(`No equipment order found for ${String(joiner_id)}`);
        return order.status === "backordered"
          ? { ...orderResult(order), summary: `Order ${order.id} backordered; ETA ${order.eta} is after the SLA.` }
          : { ...orderResult(order), summary: `Order ${order.id} is on track; ETA ${order.eta}.` };
      },
    },
    update_order: {
      description: "Simulate a supplier update to one existing supported demo order. Never places a replacement order.",
      schema: { joiner_id: "J-004|J-001", eta: "YYYY-MM-DD", status: "ordered|backordered", now: "iso datetime" },
      run: async ({ joiner_id, eta, status, now }) => {
        if (joiner_id !== "J-004" && joiner_id !== "J-001") return failed("Supplier update supports Aisha Okafor and Priya Raman only.");
        if (!validIsoDate(eta)) return failed("Supplier update ETA must be a real ISO date in YYYY-MM-DD format.");
        if (status !== "ordered" && status !== "backordered") return failed("Supplier update status must be ordered or backordered.");
        if (typeof now !== "string" || !Number.isFinite(Date.parse(now))) return failed("Supplier update needs a valid timestamp.");
        const order = orders.find((candidate) => candidate.joiner_id === joiner_id);
        if (!order) return failed(`No equipment order found for ${joiner_id}`);
        if (order.eta === eta && order.status === status) {
          return ok(`Supplier update for ${order.id} made no material change.`, { changed: false, ...equipmentSourceObservation(order) });
        }
        order.eta = eta;
        order.status = status;
        order.source_revision += 1;
        order.updated_at = now;
        return ok(`Supplier updated ${order.id}: ETA ${eta}, status ${status}.`, { changed: true, ...equipmentSourceObservation(order) });
      },
    },
  },
};
