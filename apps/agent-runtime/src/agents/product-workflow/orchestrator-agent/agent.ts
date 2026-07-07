/**
 * Orchestrator Agent 实现
 *
 * 负责顶层意图路由、checkpoint 恢复判断和 DAG 生成委托。根据 payload.mode
 * 选择性注册 SubAgent：pre-check 模式仅注册 pre-orchestrator（意图分类），
 * resume-check 模式仅注册 resume-checker（恢复判断），full 模式仅注册 planner（DAG 生成）。
 *
 * Responsibilities:
 * - streamOrchestratorAgent()：统一入口，根据输入自动选择 pre-check / full 模式
 * - streamOrchestratorPreCheck()：便捷包装，对 streamOrchestratorAgent 的 pre-check 模式封装
 * - streamOrchestratorResumeCheck()：委派 Resume SubAgent 判断是否需要 checkpoint 恢复
 *
 * Notes:
 * - pre-orchestrator、resume-check 和 planner 不会混用，避免 Orchestrator 在单一轮次中承担多余职责。
 */

import {
  OrchestratorAgentResultSchema,
  type OrchestratorAgentResult,
  type OrchestratorResumeCheckResult,
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
import {
  runResumeCheckDirectly,
  type ResumeSubagentInput,
} from "./resume-subagent";

export interface OrchestratorAgentOutput {
  decision: OrchestratorAgentResult;
  plan?: TaskExecutionPlan;
}

export type OrchestratorResumeCheckInput = ResumeSubagentInput;

/**
 * Orchestrator Agent 的 checkpoint 恢复判断入口。
 *
 * 直接运行 resume-checker 作为独立 DeepAgent，绕过 Orchestrator + task 工具
 * 的间接委托路径。DeepAgents 内置的 TASK_SYSTEM_PROMPT 会导致模型将恢复判断
 * 视为 trivial task 而跳过委托，因此必须绕过该机制。
 */
export async function* streamOrchestratorResumeCheck(
  input: OrchestratorResumeCheckInput,
): AsyncGenerator<
  ProductWorkflowStreamEvent,
  OrchestratorResumeCheckResult,
  void
> {
  yield {
    type: "agent-status",
    agentType: "orchestrator",
    status: "started",
    phase: "planning",
  };

  // 直接以独立 Agent 运行 resume-checker，不经过 Orchestrator 模型 + task 工具。
  let result: OrchestratorResumeCheckResult;
  let hasReasoning = false;
  const runner = runResumeCheckDirectly(input);

  let next = await runner.next();
  while (!next.done) {
    const event = next.value;
    yield event;
    if (event.type === "reasoning" && !hasReasoning) {
      hasReasoning = true;
    }
    next = await runner.next();
  }
  result = next.value;

  yield {
    type: "agent-status",
    agentType: "orchestrator",
    status: "completed",
    phase: "planning",
  };

  // 将 resume-checker 的判断结论作为 Orchestrator 的推理产出。
  yield {
    type: "reasoning",
    agentType: "orchestrator",
    content:
      result.decision === "RESUME_CHECKPOINT"
        ? `恢复判断：${result.reason_summary}`
        : `恢复判断：${result.reason_summary}`,
  };

  return result;
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
        yield {
          type: "agent-status",
          agentType: "planner",
          status: "started",
          phase: "planning",
        };
      }
    } else if (event.type === "subagent-result") {
      yield event;
      if (isPreCheck && preOrchSubagentResult === undefined) {
        preOrchSubagentResult = event.result;
      }
      if (!isPreCheck) {
        if (
          event.subagentType === "planner" &&
          plannerSubagentResult === undefined
        ) {
          plannerSubagentResult = event.result;
        }
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
  const plan =
    capturedPlan ??
    (normalizedDecision.route === "product_workflow"
      ? extractPlanFromSubagentResult(null, input)
      : undefined);

  return { decision: normalizedDecision, plan };
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
  return {
    mode: "full",
    workspace_id: input.workspaceId ?? null,
    context_source: input.contextSource ?? "none",
    product_context:
      input.productContext?.trim() || "No product context provided.",
    request_analysis: input.requestAnalysis,
    user_input: input.userInput,
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
      product_knowledge_graph: input.knowledgeGraph,
      request_analysis: input.requestAnalysis,
      user_input: input.userInput,
    }),
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
  return input.userInput.some((item) =>
    /\[form answers - (product-workflow-confirmation|.*-proposal-decision|executor-blocker-.*)\]/i.test(
      item.content,
    ),
  );
}
