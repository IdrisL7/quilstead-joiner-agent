import permissionsFile from "@/config/permissions.json";
import type { PermissionMode, PermissionRule } from "./types";

const RULES: PermissionRule[] = (permissionsFile.rules as PermissionRule[]).map((r) => ({ ...r }));

export interface Authorization {
  tool: string;
  mode: PermissionMode;
  requires: string[];
  matched_rule: string | null; // null means "no rule, prohibited by default"
}

export function authorize(tool: string): Authorization {
  const exact = RULES.find((r) => r.tool === tool);
  if (exact) return { tool, mode: exact.mode, requires: exact.requires ?? [], matched_rule: exact.tool };
  const [connector] = tool.split(".");
  const wildcard = RULES.find((r) => r.tool === `${connector}.*`);
  if (wildcard) return { tool, mode: wildcard.mode, requires: wildcard.requires ?? [], matched_rule: wildcard.tool };
  return { tool, mode: "prohibited", requires: [], matched_rule: null };
}

export const permissionRules = (): PermissionRule[] => RULES.map((r) => ({ ...r }));
