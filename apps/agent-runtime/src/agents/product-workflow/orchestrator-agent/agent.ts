/**
 * Orchestrator Agent 实现
 *
 * 负责顶层意图路由和 DAG 生成委托。根据 payload.mode
 * 选择性注册 SubAgent：pre-check 模式注册 pre-orchestrator（意图分类 + 恢复判断），
 * full 模式注册 planner（DAG 生成）。
 *
 * Responsibilities:
 * - streamOrchestratorAgent()：统一入口，根据输入自动选择 pre-check / full 模式
 * - streamOrchestratorPreCheck()：便捷包装，对 streamOrchestratorAgent 的 pre-check 模式封装
 *
 * Notes:
 * - pre-orchestrator 和 planner 不会混用，避免 Orchestrator 在单一轮次中承担多余职责。
 */

import {
  OrchestratorAgentResultSchema,
  type OrchestratorAgentResult,
  type TaskExecutionPlan,
} from "@repo/shared";

import { runAgentWithSubagent } from "../../common/run-agent-with-subagent";
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
import {
  createPreOrchestratorSubagent,
  PreOrchResultSchema,
  type PreOrchResult,
  type PreOrchestratorInput,
  buildPreOrchPayload,
  createFallbackPreOrchResult,
  extractPreOrchFromSubagentResult,
  extractPreOrchReasoning,
} from "./pre-orchestrator-subagent";

export interface OrchestratorAgentOutput {
  decision: OrchestratorAgentResult;
  plan?: TaskExecutionPlan;
}

/**
 * Orchestrator Agent 统一入口。
 * 根据 payload.mode 选择性注册对应 SubAgent，pre-check 和 full 两种模式互斥。
 */
export async function* streamOrchestratorAgent(
  input: OrchestratorAgentInput | PreOrchestratorInput,
): AsyncGenerator<
  ProductWorkflowStreamEvent,
  OrchestratorAgentOutput | OrchestratorPreCheckOutput,
  void
> {
  const isPreCheck = isPreOrchestratorInput(input);

  let preOrchSubagentResult: unknown = undefined;
  let plannerSubagentResult: unknown = undefined;
  let capturedPlan: TaskExecutionPlan | undefined;
  let plannerInvocationStarted = false;

  const payload = isPreCheck
    ? { mode: "pre-check", pre_check_payload: buildPreOrchPayload(input) }
    : createOrchestratorPayload(input);
  const outputSchema = isPreCheck
    ? PreOrchResultSchema
    : OrchestratorAgentResultSchema;

  const runner = runAgentWithSubagent({
    agentType: "orchestrator" as any,
    agentLabel: "Orchestrator Agent",
    name: "orchestrator-agent",
    // json_object 会导致模型跳过 task 工具调用直接生成 JSON 输出，
    // 因此两种模式都不能使用 responseFormat: "json_object"。
    modelOptions: { enableThinking: false, temperature: 0, maxTokens: 4096 },
    systemPrompt: ORCHESTRATOR_AGENT_PROMPT,
    // pre-check 模式只需 Pre-Orchestrator SubAgent；full 模式只需 Planner SubAgent。
    // 不混用可避免 LLM 在同一轮次中调用不该出现的 SubAgent。
    subagents: isPreCheck
      ? [createPreOrchestratorSubagent()]
      : [createPlannerSubagent()],
    payload,
    schema: outputSchema as any,
    maxRetries: isPreCheck ? 0 : 1,
    requiredSubagentType:
      !isPreCheck && input.requestAnalysis.business_model.length > 0
        ? "planner"
        : undefined,
    fallback: (reason: string) =>
      isPreCheck
        ? createFallbackPreOrchResult(input)
        : createFallbackOrchestratorDecision(input, reason),
    signal: input.signal,
  });

  let next = await runner.next();
  while (!next.done) {
    const event = next.value;

    if (event.type === "subagent-start") {
      yield event;
      if (isPreCheck && event.subagentType === "pre-orchestrator") {
        yield {
          type: "agent-status",
          agentType: "orchestrator",
          status: "started",
          phase: "planning",
        };
      } else if (!isPreCheck && event.subagentType === "planner") {
        plannerInvocationStarted = true;
        yield {
          type: "agent-status",
          agentType: "planner",
          status: "started",
          phase: "planning",
        };
      }
    } else if (event.type === "subagent-result") {
      yield event;
      // 始终捕获最后一次 SubAgent 结果：当 Orchestrator 因首次结果为空
      // 而自主重试时，使用重试后的有效结果而非第一次的空结果。
      if (isPreCheck && event.subagentType === "pre-orchestrator") {
        preOrchSubagentResult = event.result;
      }
      if (!isPreCheck && event.subagentType === "planner") {
        plannerSubagentResult = event.result;
      }
      if (isPreCheck) {
        yield {
          type: "reasoning",
          agentType: "orchestrator",
          content: extractPreOrchReasoning(preOrchSubagentResult),
        };
      } else if (event.subagentType === "planner") {
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
      }
    } else {
      yield event;
    }

    next = await runner.next();
  }

  yield {
    type: "agent-status",
    agentType: "orchestrator",
    status: "completed",
    phase: "planning",
  };

  const rawOutput = next.value;

  if (isPreCheck) {
    // 优先使用 task 工具返回值；若运行时未暴露 ToolMessage，则使用 Orchestrator 已解析的最终 JSON。
    const preOrchResult = extractPreOrchFromSubagentResult(
      preOrchSubagentResult ?? rawOutput,
      input,
    );
    const decision: OrchestratorAgentResult = {
      intent: preOrchResult.intent,
      route:
        preOrchResult.decision === "HANDOFF_CHAT"
          ? "conversation"
          : "product_workflow",
      context_source: "none",
      has_project_context: input.hasExistingProject,
      reason_summary: preOrchResult.reason,
      warnings: [],
    };
    return { preOrchResult, decision };
  }

  const result = OrchestratorAgentResultSchema.safeParse(rawOutput);
  const decision = result.success
    ? result.data
    : createFallbackOrchestratorDecision(input, "invalid-orch-output");
  const normalizedDecision = normalizeOrchestratorDecision(input, decision);
  return {
    decision: normalizedDecision,
    plan: requireDelegatedPlannerPlan(
      normalizedDecision.route,
      capturedPlan,
      plannerInvocationStarted,
    ),
  };
}

/**
 * 产品工作流必须来自一次真实 Planner Subagent 委派，不允许伪装为自动兜底计划。
 */
export function requireDelegatedPlannerPlan(
  route: OrchestratorAgentResult["route"],
  capturedPlan: TaskExecutionPlan | undefined,
  plannerInvocationStarted: boolean,
): TaskExecutionPlan | undefined {
  if (route === "product_workflow" && !capturedPlan) {
    throw new Error(
      plannerInvocationStarted
        ? "Planner Subagent 已调用，但未返回可用计划，请重新运行本轮规划。"
        : "Orchestrator 未调用 Planner Subagent，请重新运行本轮规划。",
    );
  }
  return capturedPlan;
}

/**
 * Pre-Check 模式便捷包装。
 * 调用同一个 Orchestrator Agent（含 pre-orchestrator SubAgent）完成意图分类。
 */
export async function* streamOrchestratorPreCheck(
  input: PreOrchestratorInput,
): AsyncGenerator<ProductWorkflowStreamEvent, PreOrchResult, void> {
  const orchStream = streamOrchestratorAgent(input);

  let next = await orchStream.next();
  while (!next.done) {
    yield next.value;
    next = await orchStream.next();
  }

  const output = next.value as OrchestratorPreCheckOutput;
  return output.preOrchResult;
}

export interface OrchestratorPreCheckOutput {
  preOrchResult: PreOrchResult;
  decision: OrchestratorAgentResult;
}

function isPreOrchestratorInput(
  input: OrchestratorAgentInput | PreOrchestratorInput,
): input is PreOrchestratorInput {
  return "hasExistingProject" in input && "userMessage" in input;
}

function createOrchestratorPayload(input: OrchestratorAgentInput) {
  const compactGraph = compactGraphForPlanner(input.knowledgeGraph);

  return {
    mode: "full",
    workspace_id: input.workspaceId ?? null,
    context_source: input.contextSource ?? "none",
    product_context:
      input.productContext?.trim() || "No product context provided.",
    request_analysis: input.requestAnalysis,
    user_input: input.userInput,
    supplement_agents: input.supplementAgentTypes ?? [],
    graph_stats: {
      current_state: input.knowledgeGraph.current_state ?? null,
      description: input.knowledgeGraph.description ?? "",
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
      product_context: input.productContext || "No product context provided.",
      product_knowledge_graph: compactGraph,
      request_analysis: input.requestAnalysis,
      user_input: input.userInput,
      supplement_agents: input.supplementAgentTypes ?? [],
    }),
  };
}

/**
 * 为 Planner SubAgent 生成精简知识图谱摘要，去除 entity description 和 relation description。
 * Planner 仅需了解图谱结构（有哪些节点、什么类型、关系拓扑）即可生成 DAG，
 * 无需完整节点描述（每个 entity description 约 200-600 字符，在 100+ 节点时浪费严重）。
 */
function compactGraphForPlanner(
  knowledgeGraph: OrchestratorAgentInput["knowledgeGraph"],
) {
  const MAX_ENTITY_NAME = 120;
  const MAX_SUMMARY_LEN = 600;

  return {
    current_state: knowledgeGraph.current_state,
    description: (knowledgeGraph.description ?? "").slice(0, 800),
    counts: {
      entities: knowledgeGraph.entities.length,
      relations: knowledgeGraph.relations.length,
      decisions: knowledgeGraph.decisions.length,
      risks: knowledgeGraph.risks.length,
      open_questions: knowledgeGraph.open_questions.length,
    },
    latest_summaries: knowledgeGraph.summary
      .slice(-4)
      .map((s) =>
        s.length > MAX_SUMMARY_LEN
          ? `${s.slice(0, MAX_SUMMARY_LEN)}...`
          : s,
      ),
    entities: knowledgeGraph.entities.map((node) => ({
      id: node.id,
      type: node.type,
      name:
        node.name.length > MAX_ENTITY_NAME
          ? `${node.name.slice(0, MAX_ENTITY_NAME)}...`
          : node.name,
      source_task_id: node.source_task_id,
      status: node.status,
    })),
    relations: knowledgeGraph.relations.map((rel) => ({
      id: rel.id,
      type: rel.type,
      source: rel.source,
      target: rel.target,
    })),
  };
}

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
      ? {
          plan_type: isWorkflowSupplementInput(input)
            ? "supplement"
            : "initial",
        }
      : {}),
    context_source: input.contextSource ?? "none",
    has_project_context: hasProjectContext,
    reason_summary: hasBusinessRequest
      ? "Fallback route selected from Request Agent business_model coverage and available project context."
      : "Fallback route selected because Request Agent found no product workflow business_model items.",
    warnings: [`Orchestrator fallback was used: ${reason}`],
  });
}

function normalizeOrchestratorDecision(
  input: OrchestratorAgentInput,
  decision: OrchestratorAgentResult,
): OrchestratorAgentResult {
  const hasBusinessRequest = input.requestAnalysis.business_model.length > 0;
  const hasProjectContext = hasMeaningfulProjectContext(input);
  const route = hasBusinessRequest ? "product_workflow" : "conversation";
  const intent =
    route === "conversation"
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
      ? {
          plan_type:
            decision.plan_type ??
            (isWorkflowSupplementInput(input) ? "supplement" : "initial"),
        }
      : { plan_type: undefined }),
  };
}

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

function isWorkflowSupplementInput(input: OrchestratorAgentInput): boolean {
  return (
    Boolean(input.supplementAgentTypes?.length) ||
    input.userInput.some((item) =>
      /\[form answers - [^\]]+\]/i.test(item.content),
    )
  );
}
