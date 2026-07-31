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

import { resolveJsonOutput, runAgent } from "../../common/run-agent";
import {
  createModelSummarySnapshot,
  resolveAgentModelSelection,
} from "../../common/model-profile";
import type {
  OrchestratorAgentInput,
  ProductWorkflowStreamEvent,
} from "../types";
import { ORCHESTRATOR_AGENT_PROMPT } from "./prompt";
import {
  createPlannerSubagent,
  extractPlanFromSubagentResult,
  formatTaskExecutionPlanBlock,
} from "./planner-subagent";
import {
  createPreOrchestratorSubagent,
  PreOrchResultSchema,
  type PreOrchResult,
  type PreOrchestratorInput,
  buildPreOrchPayload,
  createFallbackPreOrchResult,
  extractPreOrchFromSubagentResult,
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

  let rawOutput: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const runner = runAgent({
      agentType: "orchestrator" as any,
      agentLabel: "Orchestrator Agent",
      name: "orchestrator-agent",
      // json_object 会导致模型跳过 task 工具调用直接生成 JSON 输出，
      // 因此两种模式都不能使用 responseFormat: "json_object"。
      modelOptions: { enableThinking: true, temperature: 0, maxTokens: 16384 },
      modelProfile: input.modelProfile,
      modelGroup: "orchestrator",
      modelSummary: {
        current: createModelSummarySnapshot(
          resolveAgentModelSelection(input.modelProfile, "orchestrator"),
        ),
        delegatedSubagent: createModelSummarySnapshot(
          resolveAgentModelSelection(
            input.modelProfile,
            isPreCheck ? "pre-orchestrator" : "planner",
          ),
        ),
      },
      systemPrompt: ORCHESTRATOR_AGENT_PROMPT,
      // pre-check 模式只需 Pre-Orchestrator SubAgent；full 模式只需 Planner SubAgent。
      // 不混用可避免 LLM 在同一轮次中调用不该出现的 SubAgent。
      subagents: isPreCheck
        ? [createPreOrchestratorSubagent(input.modelProfile)]
        : [createPlannerSubagent(input.modelProfile)],
      subagentModelGroups: isPreCheck
        ? { "pre-orchestrator": "pre-orchestrator" }
        : { planner: "planner" },
      payload:
        attempt === 1
          ? payload
          : {
              ...payload,
              retry_context: {
                attempt,
                error: "required-subagent-not-invoked: planner",
                previous_raw_output:
                  "No Planner task call was emitted by the previous attempt.",
              },
            },
      resolveOutput: (context) =>
        resolveJsonOutput(context, outputSchema as any),
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

    try {
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
          if (!isPreCheck && event.subagentType === "planner") {
            capturedPlan = extractPlanFromSubagentResult(
              plannerSubagentResult,
              input,
            );
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
      rawOutput = next.value;
      break;
    } catch (error) {
      if (!shouldRetryPlannerDelegation(error, attempt)) throw error;
      yield {
        type: "reasoning",
        agentType: "orchestrator",
        content:
          "Planner SubAgent was not invoked; retrying delegation once.\n",
      };
    }
  }

  yield {
    type: "agent-status",
    agentType: "orchestrator",
    status: "completed",
    phase: "planning",
  };

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
  const plan = requireDelegatedPlannerPlan(
    normalizedDecision.route,
    capturedPlan,
    plannerInvocationStarted,
  );
  return {
    decision: plan
      ? {
          ...normalizedDecision,
          plan_type: plan.status,
          planner_delegation_summary: createPlannerDelegationSummary(plan),
        }
      : normalizedDecision,
    plan,
  };
}

/**
 * Planner 首次漏调时仅重试一次；第二次失败交给工作流错误处理。
 */
export function shouldRetryPlannerDelegation(
  error: unknown,
  attempt: number,
): boolean {
  return (
    attempt === 1 &&
    error instanceof Error &&
    error.message === "required-subagent-not-invoked: planner"
  );
}

/**
 * 基于运行时最终采用的 DAG 生成摘要，避免模型原始计划与裁剪后计划不一致。
 */
export function createPlannerDelegationSummary(
  plan: TaskExecutionPlan,
): string {
  const tasks = plan.tasks.map((task) => {
    const dependencies = task.depends_on.length
      ? ` after ${task.depends_on.join(", ")}`
      : "";
    return `${task.task_id} (${task.title}, ${task.assigned_agent}${dependencies})`;
  });
  return `Planner produced a ${plan.status} DAG with ${plan.tasks.length} tasks: ${tasks.join("; ")}.`.slice(
    0,
    1200,
  );
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
  const compactGraph = compactGraphForPlanner(
    input.knowledgeGraph,
    isWorkflowSupplementInput(input),
    input.supplementSourceTaskIds,
    input.supplementAffectedTaskIds,
  );

  return {
    mode: "full",
    workspace_id: input.workspaceId ?? null,
    context_source: input.contextSource ?? "none",
    product_context:
      input.productContext?.trim() || "No product context provided.",
    request_analysis: input.requestAnalysis,
    user_input: input.userInput,
    supplement_agents: input.supplementAgentTypes ?? [],
    answered_open_question_ids: input.answeredOpenQuestionIds ?? [],
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
      supplement_source_task_ids: input.supplementSourceTaskIds ?? [],
      supplement_affected_task_ids: input.supplementAffectedTaskIds ?? [],
      answered_open_question_ids: input.answeredOpenQuestionIds ?? [],
    }),
  };
}

/**
 * 为 Planner SubAgent 生成精简知识图谱摘要。
 * 初始轮次仅提供结构；补充轮次为来源任务和一跳影响节点保留截断描述，
 * 让 Planner 能识别语义冲突，同时避免复制完整图谱。
 */
export function compactGraphForPlanner(
  knowledgeGraph: OrchestratorAgentInput["knowledgeGraph"],
  supplement = false,
  sourceTaskIds: string[] = [],
  affectedTaskIds: string[] = [],
) {
  const MAX_ENTITY_NAME = 120;
  const MAX_ENTITY_DESCRIPTION = 240;
  const MAX_RELATION_DESCRIPTION = 180;
  const MAX_SUMMARY_LEN = 600;
  const entities = supplement
    ? selectSupplementPlannerEntities(
        knowledgeGraph,
        sourceTaskIds,
        affectedTaskIds,
      )
    : knowledgeGraph.entities;
  const entityIds = new Set(entities.map((entity) => entity.id));
  const sourceEntityIds = new Set(
    knowledgeGraph.entities
      .filter(
        (entity) =>
          entity.source_task_id &&
          sourceTaskIds.includes(entity.source_task_id),
      )
      .map((entity) => entity.id),
  );
  const relations = supplement
    ? knowledgeGraph.relations
        .filter(
          (relation) =>
            entityIds.has(relation.source) && entityIds.has(relation.target),
        )
        .sort(
          (left, right) =>
            Number(
              sourceEntityIds.has(right.source) ||
                sourceEntityIds.has(right.target),
            ) -
            Number(
              sourceEntityIds.has(left.source) ||
                sourceEntityIds.has(left.target),
            ),
        )
        .slice(0, 64)
    : knowledgeGraph.relations;

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
        s.length > MAX_SUMMARY_LEN ? `${s.slice(0, MAX_SUMMARY_LEN)}...` : s,
      ),
    open_questions: knowledgeGraph.open_questions.slice(-8).map((question) => ({
      id: question.id,
      text: question.text.slice(0, MAX_ENTITY_NAME),
      blocking: question.blocking,
      source_task_id: question.source_task_id,
    })),
    entities: entities.map((node) => ({
      id: node.id,
      type: node.type,
      name:
        node.name.length > MAX_ENTITY_NAME
          ? `${node.name.slice(0, MAX_ENTITY_NAME)}...`
          : node.name,
      source_task_id: node.source_task_id,
      status: node.status,
      ...(supplement && node.description
        ? {
            description:
              node.description.length > MAX_ENTITY_DESCRIPTION
                ? `${node.description.slice(0, MAX_ENTITY_DESCRIPTION)}...`
                : node.description,
          }
        : {}),
      ...(supplement && node.replacement_node_id
        ? { replacement_node_id: node.replacement_node_id }
        : {}),
    })),
    relations: relations.map((rel) => ({
      id: rel.id,
      type: rel.type,
      source: rel.source,
      target: rel.target,
      source_task_id: rel.source_task_id,
      ...(supplement && rel.description
        ? {
            description:
              rel.description.length > MAX_RELATION_DESCRIPTION
                ? `${rel.description.slice(0, MAX_RELATION_DESCRIPTION)}...`
                : rel.description,
          }
        : {}),
    })),
  };
}

/**
 * 补充轮次优先传递来源任务、受影响任务、一跳邻居及替换节点，并用少量全局节点补足语境。
 */
function selectSupplementPlannerEntities(
  knowledgeGraph: OrchestratorAgentInput["knowledgeGraph"],
  sourceTaskIds: string[],
  affectedTaskIds: string[],
) {
  const entities = knowledgeGraph.entities;
  const sourceTasks = new Set(sourceTaskIds);
  const affectedTasks = new Set([...sourceTaskIds, ...affectedTaskIds]);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const selected = new Map<string, (typeof entities)[number]>();

  for (const entity of entities) {
    if (entity.source_task_id && sourceTasks.has(entity.source_task_id)) {
      selected.set(entity.id, entity);
    }
  }
  for (const entity of entities) {
    if (entity.source_task_id && affectedTasks.has(entity.source_task_id)) {
      selected.set(entity.id, entity);
    }
  }
  const directlyAffectedIds = new Set(selected.keys());
  for (const relation of knowledgeGraph.relations) {
    if (
      !directlyAffectedIds.has(relation.source) &&
      !directlyAffectedIds.has(relation.target)
    ) {
      continue;
    }
    const source = entityById.get(relation.source);
    const target = entityById.get(relation.target);
    if (source) selected.set(source.id, source);
    if (target) selected.set(target.id, target);
  }
  for (const entity of [...selected.values()]) {
    if (!entity.replacement_node_id) continue;
    const replacement = entityById.get(entity.replacement_node_id);
    if (replacement) selected.set(replacement.id, replacement);
  }
  for (const entity of entities) {
    if (["Goal", "Decision", "OpenQuestion"].includes(entity.type)) {
      selected.set(entity.id, entity);
    }
  }
  for (const entity of entities.slice(-10)) {
    selected.set(entity.id, entity);
  }
  return [...selected.values()].slice(0, 40);
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
