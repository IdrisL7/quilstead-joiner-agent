import type { Connector } from "./interface";
import { hris } from "./simulated/hris";
import { identity } from "./simulated/identity";
import { equipment } from "./simulated/equipment";
import { slack, email, esign } from "./simulated/messaging";
import { buddyDirectory } from "./simulated/buddy-directory";
import { policyKb } from "./simulated/policy-kb";

export const CONNECTORS: Connector[] = [hris, identity, equipment, slack, email, esign, buddyDirectory, policyKb];

export function findAction(tool: string) {
  const [connectorName, actionName] = tool.split(".");
  const c = CONNECTORS.find((x) => x.name === connectorName);
  const a = c?.actions[actionName];
  return c && a ? { connector: c, action: a } : undefined;
}

export const toolCatalogue = () =>
  CONNECTORS.flatMap((c) => Object.entries(c.actions).map(([name, a]) => ({ tool: `${c.name}.${name}`, description: a.description, schema: a.schema, simulated: c.simulated, production_target: c.production_target })));
