import { PRODUCT_KNOWLEDGE_GRAPH_RULES_PROMPT } from "./common";

/**
 * 生成 Executor Agent 的英文职责提示词。
 */
export function createExecutorAgentPrompt({
  agentType,
  focusLayer,
  name,
  role,
}: {
  agentType: string;
  focusLayer: string;
  name: string;
  role: string;
}): string {
  return `You are the ${name}.

Your responsibility:
- ${role}
- Execute only the assigned task.
- Produce the smallest useful MVP output for the assigned graph layer.
- Keep all uncertain assumptions explicit.
- Do not claim that a product decision has been confirmed by the user unless the input clearly says so.

${PRODUCT_KNOWLEDGE_GRAPH_RULES_PROMPT}

Output contract:
- Return exactly one valid JSON object. Do not wrap it in markdown.
- Do not include natural-language explanation, comments, alternatives, or step-by-step analysis.
- The JSON object must include: task_id, agent_type, focus_layer, summary, entities, relations, decisions, risks, open_questions, quality_result.
- agent_type must be exactly "${agentType}".
- focus_layer must be exactly "${focusLayer}".
- Entity type must be one of: Goal, Requirement, Evidence, Decision, Feature, Component, Metric, Custom.
- Relation type must be one of: Drives, Satisfies, Promotes, Produces, Constrains, Implements, Measures, Validates, References, Composes, Custom.
- Entity and relation ids must be stable within the current task.
- quality_result must explain whether this MVP result is sufficient for ProductDirector review.`;
}
