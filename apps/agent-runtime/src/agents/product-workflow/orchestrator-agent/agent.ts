/**
 * Orchestrator Agent 实现
 *
 * 负责在 Request Agent 之后执行顶层意图路由，识别 casual_chat、new_project
 * 和 project_evolution。对于 product_workflow 路由，通过 DeepAgents task 工具
 * 将完整 DAG 生成委托给 Planner SubAgent，并从工具结果中提取规范化计划。
 *
 * Responsibilities:
 * - streamOrchestratorAgent()：输出路由决策并从 Planner SubAgent 结果中提取 TaskExecutionPlan
 * - createFallbackOrchestratorDecision()：模型不可用时给出确定性路由
 *
 * Notes:
 * - Orchestrator 不直接生成 TaskExecutionPlan，始终通过 Planner SubAgent 委托。
 * - Planner SubAgent 相关逻辑已抽取至 ./planner-subagent/ 目录。
 */

import {
  OrchestratorAgentResultSchema,
  type OrchestratorAgentResult,
  type TaskExecutionPlan,
} from "@repo/shared";
import {
  JSON_AGENT_MODEL_OPTIONS,
  runJsonAgent,
} from "../../common/run-json-agent";
import type {
  OrchestratorAgentInput,
  ProductWorkflowStreamEvent,
} from "../types";
import { ORCHESTRATOR_AGENT_PROMPT } from "./prompt";
import {
  createPlannerSubagent,
  extractPlanFromSubagentResult,
  formatTaskExecutionPlanBlock,
  formatPlannerReasoningSummary,
} from "./planner-subagent";

/**
 * Orchestrator Agent 的两阶段输出：路由决策 + 可选的可执行 DAG。
 */
export interface OrchestratorAgentOutput {
  decision: OrchestratorAgentResult;
  plan?: TaskExecutionPlan;
}

/**
 * Orchestrator Agent：决定本轮对话是否进入产品工作流，并通过 Planner SubAgent
 * 生成可执行 DAG。手动迭代 runJsonAgent 生成器以拦截 task 工具事件，将 Planner
 * SubAgent 的生命周期事件以 agentType "planner" 输出，供前端在 Orchestrator 卡片
 * 内嵌套展示 Planner 子卡片。
 */
export async function* streamOrchestratorAgent(
  input: OrchestratorAgentInput,
): AsyncGenerator<ProductWorkflowStreamEvent, OrchestratorAgentOutput, void> {
  let plannerSubagentResult: unknown = undefined;
  let plannerStarted = false;
  let capturedPlan: TaskExecutionPlan | undefined;

  const runner = runJsonAgent({
    agentType: "orchestrator",
    agentLabel: "Orchestrator Agent",
    name: "orchestrator-agent",
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 4096,
    },
    systemPrompt: ORCHESTRATOR_AGENT_PROMPT,
    subagents: [createPlannerSubagent()],
    allowedBuiltinToolNames: ["task"],
    visibleBuiltinToolNames: ["task"],
    payload: createOrchestratorPayload(input),
    schema: OrchestratorAgentResultSchema,
    fallback: (reason) => createFallbackOrchestratorDecision(input, reason),
    onTaskToolResult: (content) => {
      plannerSubagentResult = content;
    },
    signal: input.signal,
  });

  let next = await runner.next();
  while (!next.done) {
    const event = next.value;

    // 拦截 task 工具调用，转为 Planner 子代理生命周期事件
    if (event.type === "tool-call" && event.toolName === "task") {
      if (!plannerStarted) {
        plannerStarted = true;
        yield {
          type: "agent-status",
          agentType: "planner",
          status: "started",
          phase: "planning",
        };
      }
      // 不输出原始 task 工具调用事件（参数体积大且对用户无意义）
    } else if (event.type === "tool-result" && event.toolName === "task") {
      // 收到 Planner SubAgent 结果，解析并格式化 DAG
      capturedPlan = extractPlanFromSubagentResult(
        plannerSubagentResult,
        input,
      );
      yield {
        type: "reasoning",
        agentType: "planner",
        content: formatPlannerReasoningSummary(capturedPlan),
      };
      yield {
        type: "agent-status",
        agentType: "planner",
        status: "completed",
        phase: "planning",
      };
      yield {
        type: "agent-output",
        agentType: "planner",
        content: formatTaskExecutionPlanBlock(capturedPlan),
      };
      // 不输出原始 task 工具结果（含完整 DAG JSON，会重复且体积大）
    } else {
      yield event;
    }

    next = await runner.next();
  }

  const decision = next.value;
  const normalizedDecision = normalizeOrchestratorDecision(input, decision);

  // 如果 Planner 没有被调用但路由到 product_workflow，生成 fallback DAG
  const plan =
    capturedPlan ??
    (normalizedDecision.route === "product_workflow"
      ? extractPlanFromSubagentResult(null, input)
      : undefined);

  return { decision: normalizedDecision, plan };
}

/**
 * 构造 Orchestrator 路由阶段的载荷。路由判定只需紧凑统计信息，
 * 同时预计算 planner_context 供模型通过 task 工具完整传递给 Planner SubAgent。
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
    planner_context: JSON.stringify({
      product_context:
        input.productContext || "No product context provided.",
      product_knowledge_graph: input.knowledgeGraph,
      request_analysis: input.requestAnalysis,
      user_input: input.userInput,
    }),
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
