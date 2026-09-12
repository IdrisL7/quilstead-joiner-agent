import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Connector } from "../interface";
import { ok, failed } from "../interface";

// Policy knowledge base over data/policy-kb/*.md. `cite` enforces the fabrication guard:
// a citation is valid only if the quoted text is a verbatim substring of the page.

export interface KbPage {
  id: string;
  title: string;
  country: string;
  body: string;
}

const KB_DIR = path.join(process.cwd(), "data", "policy-kb");

export function loadKb(): KbPage[] {
  return readdirSync(KB_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => {
      const raw = readFileSync(path.join(KB_DIR, f), "utf8");
      const fm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      const meta = Object.fromEntries((fm?.[1] ?? "").split("\n").map((l) => l.split(/:\s([\s\S]*)/).slice(0, 2)));
      return { id: meta.id ?? f.replace(/\.md$/, ""), title: meta.title ?? f, country: meta.country ?? "ALL", body: (fm?.[2] ?? raw).trim() };
    });
}

export function searchKb(query: string, pages = loadKb()): { id: string; title: string; score: number; body: string }[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3);
  return pages
    .map((p) => {
      const hay = `${p.title}\n${p.body}`.toLowerCase();
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { id: p.id, title: p.title, score, body: p.body };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function citeIsVerbatim(pageId: string, quote: string, pages = loadKb()): boolean {
  const p = pages.find((x) => x.id === pageId);
  return !!p && quote.trim().length >= 20 && p.body.includes(quote.trim());
}

export const policyKb: Connector = {
  name: "policy_kb",
  description: "Search and cite Quilstead policy pages.",
  simulated: true,
  production_target: "Customer's policy source (Notion, Confluence, Google Docs) via MCP with the same cite guard.",
  actions: {
    search: {
      description: "Keyword search over policy pages. Returns page ids, titles and bodies.",
      schema: { query: "string" },
      run: async ({ query }) => {
        const r = searchKb(String(query ?? ""));
        return ok(`${r.length} pages matched`, r.slice(0, 3), r.length === 0 ? { next_actions: ["Escalate KB_NO_ANSWER"] } : {});
      },
    },
    cite: {
      description: "Validate that a quote is a verbatim substring of a page. Required before any joiner answer.",
      schema: { page_id: "string", quote: "string (>= 20 chars)" },
      run: async ({ page_id, quote }) => (citeIsVerbatim(String(page_id), String(quote)) ? ok("Citation verbatim", { page_id, quote }) : failed("Citation is not a verbatim substring of the page; answer withheld")),
    },
  },
};
