/**
 * Orchestrator Agent 实现
 *
 * 负责在 Request Agent 之后执行顶层意图路由，识别 casual_chat、new_project
 * 和 project_evolution，并通过 DeepAgents task 工具把规划可行性检查委派给
 * Planner 子代理。实际可执行 DAG 仍由 canonical Planner Agent 生成。
 *
 * Responsibilities:
 * - streamOrchestratorAgent()：输出 Orchestrator 路由决策
 * - createFallbackOrchestratorDecision()：模型或子代理不可用时给出确定性路由
 * - 创建只读 Planner 子代理并限制其工具权限
 *
 * Notes:
 * - Orchestrator 不直接写知识图谱，也不直接生成 TaskExecutionPlan。
 */

import type { SubAgent } from "deepagents";
import {
  OrchestratorAgentResultSchema,
  type OrchestratorAgentResult,
} from "@repo/shared";
import {
  JSON_AGENT_MODEL_OPTIONS,
  runJsonAgent,
} from "../../common/run-json-agent";
import { createDeepAgentToolAllowlistMiddleware } from "../../common/deep-agent-tool-policy";
import type {
  OrchestratorAgentInput,
  ProductWorkflowStreamEvent,
} from "../types";
import {
  ORCHESTRATOR_AGENT_PROMPT,
  ORCHESTRATOR_PLANNER_SUBAGENT_PROMPT,
} from "./prompt";

const ORCHESTRATOR_TASK_TOOL = "task";

/**
 * Orchestrator Agent：决定本轮对话是否进入产品工作流，以及应使用何种上下文。
 */
export async function* streamOrchestratorAgent(
  input: OrchestratorAgentInput,
): AsyncGenerator<ProductWorkflowStreamEvent, OrchestratorAgentResult, void> {
  const result = yield* runJsonAgent({
    agentType: "orchestrator",
    agentLabel: "Orchestrator Agent",
    name: "orchestrator-agent",
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 4096,
    },
    systemPrompt: ORCHESTRATOR_AGENT_PROMPT,
    subagents: [createPlannerReadinessSubagent()],
    allowedBuiltinToolNames: [ORCHESTRATOR_TASK_TOOL],
    payload: createOrchestratorPayload(input),
    schema: OrchestratorAgentResultSchema,
    fallback: (reason) => createFallbackOrchestratorDecision(input, reason),
    signal: input.signal,
  });

  return normalizeOrchestratorDecision(input, result);
}

/**
 * 创建 Planner 子代理；该子代理仅做规划可行性说明，不读取文件、不调用工具。
 */
function createPlannerReadinessSubagent(): SubAgent {
  const subagentToolAllowlistMiddleware =
    createDeepAgentToolAllowlistMiddleware({
      agentName: "orchestrator-planner-subagent",
      allowedToolNames: [],
    });

  return {
    name: "planner-agent",
    description:
      "Checks whether a product request is ready for canonical planning and summarizes missing planning context.",
    systemPrompt: ORCHESTRATOR_PLANNER_SUBAGENT_PROMPT,
    tools: [],
    middleware: [subagentToolAllowlistMiddleware],
  };
}

/**
 * 构造 Orchestrator 的紧凑载荷，避免把完整图谱重复塞入路由提示。
 */
function createOrchestratorPayload(input: OrchestratorAgentInput) {
  return {
    workspace_id: input.workspaceId ?? null,
    context_source: input.contextSource ?? "none",
    product_context:
      input.productContext?.trim() || "No product context provided.",
    request_analysis: input.requestAnalysis,
    user_input: input.userInput,
    graph_stats: {
      entities: input.knowledgeGraph.entities.length,
      relations: input.knowledgeGraph.relations.length,
      decisions: input.knowledgeGraph.decisions.length,
      risks: input.knowledgeGraph.risks.length,
      open_questions: input.knowledgeGraph.open_questions.length,
      summary_items: input.knowledgeGraph.summary.length,
    },
    recent_graph_nodes: input.knowledgeGraph.entities.slice(-6).map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      status: node.status,
    })),
  };
}

/**
 * 模型失败时给出保守且可继续执行的 Orchestrator 决策。
 */
export function createFallbackOrchestratorDecision(
  input: OrchestratorAgentInput,
  reason: string,
): OrchestratorAgentResult {
  const hasBusinessRequest = input.requestAnalysis.business_model.length > 0;
  const hasProjectContext = hasMeaningfulProjectContext(input);
  const route = hasBusinessRequest ? "product_workflow" : "conversation";
  const intent = !hasBusinessRequest
    ? "casual_chat"
    : hasProjectContext
      ? "project_evolution"
      : "new_project";

  return normalizeOrchestratorDecision(input, {
    intent,
    route,
    ...(route === "product_workflow"
      ? { plan_type: isWorkflowSupplementInput(input) ? "supplement" : "initial" }
      : {}),
    context_source: input.contextSource ?? "none",
    has_project_context: hasProjectContext,
    reason_summary: hasBusinessRequest
      ? "Fallback route selected from Request Agent business_model coverage and available project context."
      : "Fallback route selected because Request Agent found no product workflow business_model items.",
    warnings: [`Orchestrator fallback was used: ${reason}`],
  });
}

/**
 * 规范化模型输出，避免 route 与 Request Agent 结构冲突。
 */
function normalizeOrchestratorDecision(
  input: OrchestratorAgentInput,
  decision: OrchestratorAgentResult,
): OrchestratorAgentResult {
  const hasBusinessRequest = input.requestAnalysis.business_model.length > 0;
  const hasProjectContext = hasMeaningfulProjectContext(input);
  const route = hasBusinessRequest ? "product_workflow" : "conversation";
  const intent = route === "conversation"
    ? "casual_chat"
    : decision.intent === "project_evolution" && hasProjectContext
      ? "project_evolution"
      : decision.intent === "new_project" || !hasProjectContext
        ? "new_project"
        : "project_evolution";

  return {
    ...decision,
    intent,
    route,
    context_source: input.contextSource ?? decision.context_source,
    has_project_context: hasProjectContext,
    ...(route === "product_workflow"
      ? { plan_type: decision.plan_type ?? (isWorkflowSupplementInput(input) ? "supplement" : "initial") }
      : { plan_type: undefined }),
  };
}

/**
 * 判断本轮是否存在可供项目演化使用的上下文。
 */
function hasMeaningfulProjectContext(input: OrchestratorAgentInput): boolean {
  if (input.contextSource && input.contextSource !== "none") return true;

  return (
    input.knowledgeGraph.entities.length > 0 ||
    input.knowledgeGraph.relations.length > 0 ||
    input.knowledgeGraph.decisions.length > 0 ||
    input.knowledgeGraph.risks.length > 0 ||
    input.knowledgeGraph.open_questions.length > 0 ||
    input.knowledgeGraph.summary.length > 0
  );
}

/**
 * 识别来自工作流表单答案的补充规划输入。
 */
function isWorkflowSupplementInput(input: OrchestratorAgentInput): boolean {
  return input.userInput.some((item) =>
    /\[form answers - (product-workflow-confirmation|.*-proposal-decision|executor-blocker-.*)\]/i.test(
      item.content,
    ),
  );
}
