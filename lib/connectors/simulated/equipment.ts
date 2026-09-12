import type { Connector } from "../interface";
import { ok, failed } from "../interface";
import { addWorkingDays } from "@/lib/policy/dates";

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
}

export const orders: EquipmentOrder[] = [];

export const resetEquipmentState = (): void => {
  orders.length = 0;
};

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
        const late = LATE_FOR.has(String(joiner_id));
        const eta = addWorkingDays(String(now).slice(0, 10), late ? 12 : 3);
        const id = `EQ-${String(orders.length + 1).padStart(4, "0")}`;
        orders.push({ id, joiner_id: String(joiner_id), model: String(model), ship_to: ship_to === "home" ? "home" : "office", status: late ? "backordered" : "ordered", eta });
        return late
          ? { status: "warning", summary: `Order ${id} backordered; ETA ${eta} is after the SLA.`, data: { order_id: id, eta, status: "backordered" }, next_actions: ["Draft nudge to IT owner for approval"] }
          : ok(`Order ${id} placed; ETA ${eta}.`, { order_id: id, eta, status: "ordered" });
      },
    },
  },
};
