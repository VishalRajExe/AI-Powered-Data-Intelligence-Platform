import type { RequirementModelProvider } from "../requirements/provider.js";
import type { DataRequirement } from "../requirements/requirement.schema.js";
import { resolveDemoScenario } from "./scenarios.data.js";

export class DemoRequirementProvider implements RequirementModelProvider {
  async generateRequirement(prompt: string): Promise<DataRequirement> {
    const scenario = resolveDemoScenario(prompt);
    // Return a clone so caller mutations don't affect shared scenario template
    return JSON.parse(JSON.stringify(scenario.requirement)) as DataRequirement;
  }
}
