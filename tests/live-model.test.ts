import { beforeEach, describe, expect, it } from "vitest";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import { createLiveModel, type LiveAnthropicClient } from "@/lib/agent/live-model";
import { runAgent } from "@/lib/agent/loop";
import { prepareDemo } from "@/lib/demo-flow";
import { resetDemoState } from "@/lib/store/demo-state";

const NOW = "2026-09-30T09:00:00Z";

function response(content: Message["content"], inputTokens: number, outputTokens: number): Message {
  return {
    id: `msg-${inputTokens}`,
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5-20251001",
    stop_reason: "tool_use",
    stop_sequence: null,
    content,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

describe("live Anthropic agent adapter", () => {
  beforeEach(() => {
    resetDemoState();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("maps tool use and results, records usage, and refuses a prohibited grant", async () => {
    const requests: unknown[] = [];
    const scripted: Message[] = [
      response([{ type: "tool_use", id: "tool-state", name: "get_case_state", input: {} }], 10, 5),
      response([{ type: "tool_use", id: "tool-grant", name: "identity.grant_access", input: { joiner_id: "J-004" } }], 20, 6),
      response([{ type: "tool_use", id: "tool-finish", name: "finish", input: { next_action: "Review the current case state." } }], 30, 7),
    ];
    const client: LiveAnthropicClient = {
      messages: {
        async create(params) {
          requests.push(params);
          const next = scripted.shift();
          if (!next) throw new Error("fake client exhausted");
          return next;
        },
      },
    };

    const preparation = await prepareDemo(undefined, "mock");
    const run = await runAgent(
      preparation.case,
      preparation.joiner,
      "availability_changed",
      NOW,
      "live",
      { model: createLiveModel(client) },
    );

    expect(run.stop_reason).toBe("finished");
    expect(run.refused).toBe(1);
    expect(run.next_action).toBe("Review the current case state.");
    expect(run.input_tokens).toBe(60);
    expect(run.output_tokens).toBe(18);
    expect(run.cost_usd).toBeCloseTo(0.00015, 8);
    expect(run.trace.some((entry) => entry.kind === "agent.guard.refused" && entry.summary.includes("identity.grant_access"))).toBe(true);

    const firstRequest = requests[0] as { system?: string; tools?: Array<{ input_schema: { additionalProperties?: boolean; required?: string[] } }> };
    expect(firstRequest.system).toContain("bounded onboarding assistant");
    expect(firstRequest.system).not.toContain("demo_note");
    expect(firstRequest.tools?.every((tool) => tool.input_schema.additionalProperties === false && Array.isArray(tool.input_schema.required))).toBe(true);

    const secondRequest = requests[1] as { messages: Array<{ role: string; content: unknown }> };
    expect(JSON.stringify(secondRequest.messages.at(-1))).toContain("tool-state");
    const thirdRequest = requests[2] as { messages: Array<{ role: string; content: unknown }> };
    expect(JSON.stringify(thirdRequest.messages.at(-1))).toContain("Tool identity.grant_access refused");
  });

  it("fails clearly without an Anthropic key", () => {
    expect(() => createLiveModel()).toThrow("DEMO_MODE=live requires ANTHROPIC_API_KEY");
  });
});
