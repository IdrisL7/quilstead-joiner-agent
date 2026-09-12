import { JOINERS } from "@/data/joiners";
import type { Joiner } from "@/lib/types";

// The simulated HRIS and the case store share this small trusted snapshot. Event
// payloads update it through the case store; callers cannot mutate the stored object.

const cloneJoiner = (joiner: Joiner): Joiner => ({
  ...joiner,
  right_to_work: { ...joiner.right_to_work },
});

const initialState = (): Map<string, Joiner> => new Map(JOINERS.map((joiner) => [joiner.id, cloneJoiner(joiner)]));

let current = initialState();

export const resetJoinerState = (): void => {
  current = initialState();
};

export const currentJoinerById = (id: string): Joiner | undefined => {
  const joiner = current.get(id);
  return joiner ? cloneJoiner(joiner) : undefined;
};

export const saveCurrentJoiner = (joiner: Joiner): Joiner => {
  const snapshot = cloneJoiner(joiner);
  current.set(snapshot.id, snapshot);
  return cloneJoiner(snapshot);
};
