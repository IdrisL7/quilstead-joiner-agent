import Anthropic from "@anthropic-ai/sdk";
import type { Joiner, Task, ToolResult } from "@/lib/types";

export type ModelProvider = "mock" | "anthropic";

export interface NudgeModelInput {
  joiner: Pick<Joiner, "full_name" | "preferred_name" | "title" | "start_date" | "office" | "work_mode" | "equipment_preference">;
  equipment: ToolResult<{ eta: string; status: string }>;
  equipmentTask: Pick<Task, "owner_id" | "title" | "due_at">;
  ownerName: string;
}

export interface NudgeModelDraft {
  provider: ModelProvider;
  model: string;
  subject: string;
  body: string;
}

export const MODEL_TIMEOUT_MS = 15_000;
export const MODEL_MAX_RETRIES = 0;

const modelName = () => process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";

function mockDraft(input: NudgeModelInput): NudgeModelDraft {
  const { joiner, equipment, ownerName } = input;
  const eta = equipment.data?.eta ?? "the revised delivery date";
  return {
    provider: "mock",
    model: "deterministic-demo-model",
    subject: `Day-one laptop plan for ${joiner.preferred_name}`,
    body: `Hi ${ownerName}, ${joiner.preferred_name}'s ${joiner.equipment_preference.replaceAll("_", " ")} is due ${eta}, four days after the ${joiner.start_date} start. Can you arrange a loaner or earlier delivery so ${joiner.preferred_name} is equipped on day one?`,
  };
}

function parseModelDraft(raw: string): Pick<NudgeModelDraft, "subject" | "body"> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? raw.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error("Model response did not contain a JSON draft");

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error("Model response was not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Model response was not an object");
  const subject = "subject" in parsed && typeof parsed.subject === "string" ? parsed.subject.trim() : "";
  const body = "body" in parsed && typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (!subject || !body || subject.length > 160 || body.length > 700) {
    throw new Error("Model response did not meet the draft shape limits");
  }
  if (!/loaner|earlier delivery/i.test(body)) {
    throw new Error("Model response omitted a concrete day-one equipment mitigation");
  }
  return { subject, body };
}

async function anthropicDraft(input: NudgeModelInput): Promise<NudgeModelDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("DEMO_MODE=live requires ANTHROPIC_API_KEY");

  const model = modelName();
  const client = new Anthropic({
    apiKey,
    timeout: MODEL_TIMEOUT_MS,
    maxRetries: MODEL_MAX_RETRIES,
  });
  const response = await client.messages.create({
    model,
    max_tokens: 300,
    system: [
      "Draft one concise internal Slack nudge for an HR onboarding case.",
      "Return JSON only with exactly two string fields: subject and body.",
      "Use only the supplied facts. Do not invent dates, names, recipients, links, or approvals.",
      "The business action must ask IT to arrange a loaner or earlier delivery when the laptop arrives after the joiner's start date.",
      "Do not claim that anything was sent or ordered by the message.",
    ].join(" "),
    messages: [{
      role: "user",
      content: JSON.stringify({
        joiner: input.joiner,
        equipment: input.equipment.data,
        equipment_summary: input.equipment.summary,
        equipment_task: input.equipmentTask,
        owner_name: input.ownerName,
      }),
    }],
  });
  const text = response.content.find((block) => block.type === "text")?.text ?? "";
  return { provider: "anthropic", model, ...parseModelDraft(text) };
}

export async function draftEquipmentNudge(input: NudgeModelInput, mode = process.env.DEMO_MODE ?? "mock"): Promise<NudgeModelDraft> {
  if (mode === "live") return anthropicDraft(input);
  return mockDraft(input);
}
