import { createHmac, timingSafeEqual } from "node:crypto";
import { joinerById } from "@/data/joiners";
import type { Connector } from "../interface";
import { ok, failed } from "../interface";
import { currentJoinerById } from "@/lib/store/joiner-store";

// Simulated HRIS, shaped like the Humaans API: bearer token with scopes, HMAC-signed
// webhooks, minimum-field reads. `get_joiner` never returns identity document contents
// or the demo note; it returns the fields the plan needs and nothing else.

export const HRIS_SCOPES_ISSUED = ["public:read", "private:read", "documents:read"] as const; // no private:write in v1

export function signWebhook(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyWebhook(rawBody: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signWebhook(rawBody, secret), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const hris: Connector = {
  name: "hris",
  description: "Joiner record reads and signed webhook verification.",
  simulated: true,
  production_target: "Humaans API (people, job roles, identity documents status) or Workday RaaS for reads; webhooks with HMAC SHA-256.",
  actions: {
    get_joiner: {
      description: "Minimum joiner fields for planning. No document contents, no bank or compensation data.",
      schema: { joiner_id: "string" },
      run: async ({ joiner_id }) => {
        const j = currentJoinerById(String(joiner_id)) ?? joinerById(String(joiner_id));
        if (!j) return failed(`No joiner ${joiner_id}`);
        const { demo_note: _demo, right_to_work, personal_email: _email, ...rest } = j;
        void _demo;
        void _email;
        return ok(`Joiner ${j.id} read with ${HRIS_SCOPES_ISSUED.join(", ")}`, {
          ...rest,
          right_to_work: { status: right_to_work.status, evidenced_at: right_to_work.evidenced_at ?? null },
        });
      },
    },
    verify_webhook: {
      description: "Verify the HMAC SHA-256 signature on an inbound webhook body.",
      schema: { raw_body: "string", signature: "string", secret: "string" },
      run: async ({ raw_body, signature, secret }) => {
        const valid = verifyWebhook(String(raw_body), String(signature), String(secret));
        return valid ? ok("Signature valid", { valid }) : failed("Signature invalid; event dropped", false);
      },
    },
  },
};
