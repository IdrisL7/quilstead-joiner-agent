import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/demo/route";

function request(body: Record<string, string> = {}) {
  return new Request("http://localhost/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("demo approval route", () => {
  it("rejects an approval from a superseded run", async () => {
    const oldResponse = await POST(request());
    const oldRun = await oldResponse.json() as { run_id: string };
    const currentResponse = await POST(request());
    const currentRun = await currentResponse.json() as { run_id: string };

    expect(currentRun.run_id).not.toBe(oldRun.run_id);

    const staleDecision = await POST(request({ run_id: oldRun.run_id, decision: "approve" }));
    expect(staleDecision.status).toBe(409);

    const currentDecision = await POST(request({ run_id: currentRun.run_id, decision: "approve" }));
    expect(currentDecision.status).toBe(200);
    expect((await currentDecision.json()).after_approval.status).toBe("ok");
  });
});
