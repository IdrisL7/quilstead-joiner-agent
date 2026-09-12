import { ACCESS_MATRIX } from "@/data/access-matrix";
import type { AccessGrant, Joiner } from "@/lib/types";

export const accessRowsFor = (j: Joiner): AccessGrant[] => ACCESS_MATRIX[j.role] ?? [];
