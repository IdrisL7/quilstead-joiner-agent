import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  Anthropic: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: sdk.Anthropic,
}));

import { draftEquipmentNudge, MODEL_MAX_RETRIES, MODEL_TIMEOUT_MS } from "@/lib/model";

const input = {
  joiner: {
    full_name: "Aisha Okafor",
    preferred_name: "Aisha",
    title: "Customer Success Manager",
    start_date: "2026-10-12",
    office: "London",
    work_mode: "hybrid" as const,
    equipment_preference: "macbook_pro_14" as const,
  },
  equipment: {
    status: "warning" as const,
    summary: "Order EQ-0001 backordered; ETA 2026-10-16 is after the SLA.",
    data: { eta: "2026-10-16", status: "backordered" },
  },
  equipmentTask: { owner_id: "it-1", title: "Order laptop", due_at: "2026-10-06T17:00:00Z" },
  ownerName: "Nadia Hussain",
};

function withFakeKey<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key-not-a-secret";
  return fn().finally(() => {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  });
}

describe("bounded live drafting", () => {
  beforeEach(() => {
    sdk.create.mockReset();
    sdk.Anthropic.mockReset();
    sdk.Anthropic.mockImplementation(() => ({ messages: { create: sdk.create } }));
  });

  it("keeps mock mode deterministic and action-oriented", async () => {
    const draft = await draftEquipmentNudge(input, "mock");
    expect(draft.provider).toBe("mock");
    expect(draft.body).toContain("loaner or earlier delivery");
    expect(sdk.Anthropic).not.toHaveBeenCalled();
  });

  it("rejects malformed model output before a draft can be created", async () => {
    sdk.create.mockResolvedValue({ content: [{ type: "text", text: "not JSON" }] });

    await expect(withFakeKey(() => draftEquipmentNudge(input, "live"))).rejects.toThrow("JSON draft");
    expect(sdk.Anthropic).toHaveBeenCalledWith({
      apiKey: "test-key-not-a-secret",
      timeout: MODEL_TIMEOUT_MS,
      maxRetries: MODEL_MAX_RETRIES,
    });
  });

  it("surfaces a timeout or API failure instead of falling back silently", async () => {
    sdk.create.mockRejectedValue(new Error("request timed out"));

    await expect(withFakeKey(() => draftEquipmentNudge(input, "live"))).rejects.toThrow("request timed out");
  });

  it("fails clearly when live mode has no key", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(draftEquipmentNudge(input, "live")).rejects.toThrow("requires ANTHROPIC_API_KEY");
    } finally {
      if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});
