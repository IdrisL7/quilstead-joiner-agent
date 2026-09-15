import { randomUUID } from "node:crypto";
import { CaseStore } from "@/lib/store/case-store";
import type { DemoPreparation } from "@/lib/demo-flow";

interface StoredRun {
  run: DemoPreparation;
  revision: number;
}

export interface DemoRunSnapshot {
  run: DemoPreparation;
  case_id: string;
  revision: number;
  generation: number;
}

let runsByCaseId = new Map<string, StoredRun>();
let demoStore = new CaseStore();
let generation = 0;

function cloneRun(run: DemoPreparation): DemoPreparation {
  const { store, ...serializable } = run;
  return { ...structuredClone(serializable), store };
}

export function getDemoStore(): CaseStore {
  return demoStore;
}

export function getDemoRun(caseId: string): DemoPreparation | null {
  return runsByCaseId.get(caseId)?.run ?? null;
}

export function listDemoRuns(): DemoPreparation[] {
  return [...runsByCaseId.values()].map((entry) => entry.run);
}

export function saveDemoRun(run: DemoPreparation): DemoPreparation {
  const previous = runsByCaseId.get(run.case.id);
  if (!demoStore.replace(run.case)) throw new Error(`Demo case ${run.case.id} is not present in the authoritative store.`);
  run.store = demoStore;
  runsByCaseId.set(run.case.id, { run, revision: (previous?.revision ?? 0) + 1 });
  return run;
}

export function commitDemoMutation(token: string, run: DemoPreparation): boolean {
  if (!demoMutationIsCurrent(token)) return false;
  saveDemoRun(run);
  return true;
}

export function demoMutationIsCurrent(token: string): boolean {
  return Boolean(mutationToken && mutationToken.id === token && mutationToken.generation === generation);
}

export function captureDemoRun(caseId: string): DemoRunSnapshot | null {
  const stored = runsByCaseId.get(caseId);
  if (!stored) return null;
  return { run: cloneRun(stored.run), case_id: caseId, revision: stored.revision, generation };
}

export function commitDemoRun(snapshot: DemoRunSnapshot, run: DemoPreparation): boolean {
  const current = runsByCaseId.get(snapshot.case_id);
  if (snapshot.generation !== generation || !current || current.revision !== snapshot.revision) return false;
  if (!demoStore.replace(run.case)) return false;
  run.store = demoStore;
  runsByCaseId.set(snapshot.case_id, { run, revision: current.revision + 1 });
  return true;
}

interface MutationToken {
  id: string;
  generation: number;
}

let mutationToken: MutationToken | null = null;

export function beginDemoMutation(): string | null {
  if (mutationToken) return null;
  mutationToken = { id: randomUUID(), generation };
  return mutationToken.id;
}

export function endDemoMutation(token: string): void {
  if (mutationToken?.id === token) mutationToken = null;
}

export function demoMutationInFlight(): boolean {
  return mutationToken !== null;
}

export function resetDemoSessionData(): void {
  generation += 1;
  runsByCaseId = new Map();
  demoStore = new CaseStore();
  mutationToken = null;
}

export function demoSessionGeneration(): number {
  return generation;
}
