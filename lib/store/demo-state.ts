import { resetAccessRequests } from "@/lib/connectors/simulated/identity";
import { resetDraftState } from "@/lib/connectors/simulated/messaging";
import { resetEquipmentState } from "@/lib/connectors/simulated/equipment";
import { resetBuddyState } from "@/lib/connectors/simulated/buddy-directory";
import { resetIds } from "@/lib/plan";
import { resetJoinerState } from "@/lib/store/joiner-store";

/** Reset all module-level state for an isolated demo or test run. */
export const resetDemoState = (): void => {
  resetIds();
  resetJoinerState();
  resetDraftState();
  resetAccessRequests();
  resetEquipmentState();
  resetBuddyState();
};
