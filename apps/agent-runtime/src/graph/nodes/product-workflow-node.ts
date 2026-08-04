/**
 * 产品工作流图节点
 *
 * 实现 Planner SubAgent 计划回放、Executor Router、Executor Aggregator、Critique Agent 阶段和全部 10 个 Executor Agent 的 LangGraph 节点。
 * Router 根据 Planner 生成的 DAG 动态选择下一批 Executor 分支，每个 Executor 节点按定义
 * 从 streamExecutorAgent 驱动并输出推理、工具调用和补丁结果。
 *
 * Responsibilities:
 * - 实现 plannerAgentNode：回放 Orchestrator 内 Planner SubAgent 生成的 DAG
 * - 实现各 Executor 节点：读取知识图谱、执行任务、产出图谱补丁
 * - 实现 executorRouterNode / selectNextExecutorRouterTargets：按 DAG 依赖顺序调度下一批 Executor
 * - 实现 executorAggregatorNode：汇合同批 Executor 状态并发出知识图谱更新
 * - 管理 executorResults 累积和执行计划状态
 */

import { randomUUID } from "node:crypto";
import { getWriter, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { ProductWorkflowResult, TaskExecutionNode } from "@repo/shared";
import { inferSupplementAffectedTaskIds } from "../../agents/conversation/workflow-resume";
import type { UserInputRecord } from "../../agents/request/user-input";
import type { ProductWorkflowStreamEvent } from "../../agents/product-workflow/agent";
import {
  EXECUTOR_DEFINITIONS,
  isExecutorAgentType,
  type ExecutorAgentType,
} from "../../agents/product-workflow/executor-agent/definitions";
import {
  createProductWorkflowKnowledgeGraph,
  appendKnowledgeGraphPatch,
  formatExecutorResultBlock,
  formatProductWorkflowBlock,
  formatTaskExecutionPlanBlock,
  streamExecutorAgent,
  streamOrchestratorAgent,
  streamCritiqueAgent,
  type OrchestratorAgentOutput,
} from "../../agents/product-workflow/agent";
import { getModelProfileFromRunnableConfig } from "../../agents/common/model-profile";
import { updateProductContextMetadata } from "../../agents/product-workflow/common/context-metadata";
import { isDocumentEvidenceSupplement } from "../../agents/product-workflow/types";
import type { WorkflowGraphStateValue } from "../state";

const AUTOMATIC_CRITIQUE_CORRECTION_MARKER =
  "[automatic critique correction]";

/**
 * Planner 节点：显示 Orchestrator 的 Planner SubAgent 生成的 DAG，
 * 或在 checkpoint 恢复时重放已有的 Executor 结果。
 */
export async function plannerAgentNode(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  if (!state.requestAnalysis) return {};
  if (state.plan) {
    const writer = getWriter(config);
    const isFreshPlan = state.executorResults.length === 0;

    // 新鲜计划（由 Orchestrator 的 Planner SubAgent 刚生成）已有完整生命周期事件，
    // 此处仅输出 Executor 回放结果；从 checkpoint 恢复的计划需完整状态事件。
    if (!isFreshPlan) {
      writer?.({
        type: "agent-status",
        agentType: "planner",
        status: "started",
        phase: "planning",
      });
    }
    writer?.({
      type: "agent-output",
      agentType: "planner",
      content: formatTaskExecutionPlanBlock(state.plan),
    });
    for (const result of state.executorResults) {
      writer?.({
        type: "agent-output",
        agentType: result.agent_type,
        content: formatExecutorResultBlock(result),
      });
    }
    if (!isFreshPlan) {
      writer?.({
        type: "agent-status",
        agentType: "planner",
        status: "completed",
        phase: "planning",
      });
    }

    return {
      knowledgeGraph:
        state.knowledgeGraph ?? createProductWorkflowKnowledgeGraph(),
      plan: state.plan,
    };
  }

  // plan 缺失时不应发生（Orchestrator 始终生成 plan 或 fallback），直接透传现有图谱
  return {
    knowledgeGraph:
      state.knowledgeGraph ?? createProductWorkflowKnowledgeGraph(),
  };
}

/**
 * 执行 Orchestrator Agent 节点，接管产品工作流路由、上下文来源判断、Planner DAG
 * 生成和收尾审查调度。
 */
export async function orchestratorAgentNode(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
): Promise<Partial<WorkflowGraphStateValue>> {
  if (!state.requestAnalysis || state.productWorkflow) return {};
  if (state.plan && arePlanTasksFinished(state)) {
    return executeCritiqueAgentReview(state, config);
  }
  // 恢复运行时沿用已有 DAG；只有缺少计划时才重新调用 Orchestrator。
  if (state.plan) return {};
  if (state.orchestratorDecision) {
    return { orchestratorDecision: state.orchestratorDecision };
  }

  const writer = getWriter(config);
  let knowledgeGraph =
    state.knowledgeGraph ?? createProductWorkflowKnowledgeGraph();

  if (state.requestAnalysis.business_model.length > 0) {
    writer?.(createWorkflowRoundStartEvent());
    const isSupplement = isSupplementWorkflow(state);
    knowledgeGraph = updateProductContextMetadata({
      knowledgeGraph,
      currentState: isSupplement ? "refining" : "initial",
      descriptionEntry: isSupplement
        ? "Orchestrator Agent resumed a refining product workflow from user form answers."
        : "Orchestrator Agent started a product workflow after user clarification or structured input was available.",
    });
    writer?.({
      type: "knowledge-graph-update",
      knowledgeGraph,
    });
  }

  writer?.({
    type: "agent-status",
    agentType: "orchestrator",
    status: "started",
    phase: "planning",
  });
  const { decision, plan } = (await consumeProductWorkflowStream(
    streamOrchestratorAgent({
      modelProfile: getModelProfileFromRunnableConfig(config),
      workspaceId: state.workspaceId,
      productContext: state.productContext,
      contextSource: state.contextSource,
      requestAnalysis: state.requestAnalysis,
      userInput: state.userInput,
      knowledgeGraph,
      supplementAgentTypes: state.supplementAgentTypes,
      supplementSourceTaskIds: state.supplementSourceTaskIds,
      supplementAffectedTaskIds: state.supplementAffectedTaskIds,
      answeredOpenQuestionIds: state.answeredOpenQuestionIds,
      signal: config?.signal,
    }),
    writer,
  )) as OrchestratorAgentOutput;
  writer?.({
    type: "reasoning",
    agentType: "orchestrator",
    content: `${decision.reason_summary}\n`,
  });
  writer?.({
    type: "agent-status",
    agentType: "orchestrator",
    status: "completed",
    phase: "planning",
  });
  knowledgeGraph = updateProductContextMetadata({
    knowledgeGraph,
    currentState:
      plan?.status === "supplement"
        ? "refining"
        : plan
          ? "building"
          : "initial",
    descriptionEntry: createOrchestratorDescriptionEntry(decision, plan),
  });
  writer?.({
    type: "knowledge-graph-update",
    knowledgeGraph,
  });

  // Planner 生命周期事件（agent-status / agent-output）已由 streamOrchestratorAgent
  // 在 task 工具结果到达时通过 agentType "planner" 内嵌输出，此处不再重复。

  return { knowledgeGraph, orchestratorDecision: decision, plan };
}

/**
 * 为一次真正的新 DAG 规划生成独立且稳定的流式轮次标识。
 */
export function createWorkflowRoundStartEvent(): Extract<
  ProductWorkflowStreamEvent,
  { type: "workflow-round-start" }
> {
  return {
    type: "workflow-round-start",
    roundId: randomUUID(),
  };
}

/**
 * 注册到 LangGraph 的十个独立 Executor Agent 节点名称。
 */
export const EXECUTOR_AGENT_NODE_NAMES = EXECUTOR_DEFINITIONS.map(
  (definition) => definition.agentType,
);

/**
 * 执行 Product Strategy Executor 节点。
 */
export const productStrategyExecutorNode = createExecutorAgentNode(
  "executor-product-strategy",
);

/**
 * 执行 Market Research Executor 节点。
 */
export const marketResearchExecutorNode = createExecutorAgentNode(
  "executor-market-research",
);

/**
 * 执行 Go-to-Market Executor 节点。
 */
export const gtmExecutorNode = createExecutorAgentNode("executor-gtm");

/**
 * 执行 Product Discovery Executor 节点。
 */
export const productDiscoveryExecutorNode = createExecutorAgentNode(
  "executor-product-discovery",
);

/**
 * 执行 Product Execution Executor 节点。
 */
export const productExecutionExecutorNode = createExecutorAgentNode(
  "executor-product-execution",
);

/**
 * 执行 Marketing Growth Executor 节点。
 */
export const marketingGrowthExecutorNode = createExecutorAgentNode(
  "executor-marketing-growth",
);

/**
 * 执行 Data Analytics Executor 节点。
 */
export const dataAnalyticsExecutorNode = createExecutorAgentNode(
  "executor-data-analytics",
);

/**
 * 执行 AI Shipping Executor 节点。
 */
export const aiShippingExecutorNode = createExecutorAgentNode(
  "executor-ai-shipping",
);

/**
 * 执行 Toolkit Executor 节点。
 */
export const toolkitExecutorNode = createExecutorAgentNode("executor-toolkit");

/**
 * 执行 Interface Craft Executor 节点。
 */
export const interfaceCraftExecutorNode = createExecutorAgentNode(
  "executor-interface-craft",
);

/**
 * 固定骨架中的 Executor Router 节点。
 *
 * 节点本身不修改状态，后续条件边会根据 Planner 生成的 DAG、已完成任务和最终汇总状态，
 * 动态选择下一批 Executor、回到 Critique Agent，或结束工作流。
 */
export async function executorRouterNode() {
  return {};
}

/**
 * 汇合同一批并行 Executor 的状态更新，并只在合并后归档知识图谱。
 */
export async function executorAggregatorNode(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  const writer = getWriter(config);
  if (state.knowledgeGraph) {
    writer?.({
      type: "knowledge-graph-update",
      knowledgeGraph: state.knowledgeGraph,
    });
  }

  return {};
}

/**
 * 兼容旧命名：历史上该节点承担并行批次屏障职责，现在语义上是固定骨架中的 Aggregator。
 */
export const executorBatchBarrierNode = executorAggregatorNode;

/**
 * 创建单个 Executor Agent 节点，按 Planner DAG 执行当前 Agent 的下一个就绪任务。
 */
function createExecutorAgentNode(agentType: ExecutorAgentType) {
  return async function executorAgentNode(
    state: WorkflowGraphStateValue,
    config?: LangGraphRunnableConfig,
  ) {
    return executeExecutorAgentTask(agentType, state, config);
  };
}

/**
 * 执行指定 Executor Agent 的单个就绪任务。
 */
async function executeExecutorAgentTask(
  agentType: ExecutorAgentType,
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  if (!state.requestAnalysis || !state.plan) return {};

  const writer = getWriter(config);
  const task = findNextExecutableTaskForAgent(state, agentType);
  if (!task) return {};
  const knowledgeGraph =
    state.knowledgeGraph ?? createProductWorkflowKnowledgeGraph();
  const parallelAgents = getCurrentParallelExecutorAgents(state);

  writer?.({
    type: "agent-status",
    agentType,
    status: "started",
    phase: "execution",
    parallelAgents,
    taskId: task.task_id,
  });
  const retryTaskId = config?.configurable?.retry_task_id;
  const retryError = config?.configurable?.retry_error;
  const retryInstruction =
    retryTaskId === task.task_id && typeof retryError === "string"
      ? [
          "This task is being manually retried after a previous validated failure.",
          "Correct every previously reported issue before writing graph data.",
          `Previous failure details:\n${retryError}`,
        ].join("\n")
      : undefined;

  const result = await consumeProductWorkflowStream(
    streamExecutorAgent({
      modelProfile: getModelProfileFromRunnableConfig(config),
      task,
      plan: state.plan,
      knowledgeGraph,
      workspaceId: state.workspaceId,
      productContext: state.productContext,
      requestAnalysis: state.requestAnalysis,
      userInput: state.userInput,
      previousResults: state.executorResults,
      retryInstruction,
      documentEvidenceResolution: isDocumentEvidenceSupplement(
        state.supplementSourceTaskIds,
      ),
      signal: config?.signal,
    }),
    writer,
    { parallelAgents },
  );
  const patchedKnowledgeGraph = appendKnowledgeGraphPatch({
    knowledgeGraph,
    taskId: result.task_id,
    agentType: result.agent_type,
    entities: result.entities,
    relations: result.relations,
    decisions: result.decisions,
    risks: result.risks,
    openQuestions: result.open_questions,
    summary: [result.summary],
  });
  const nextKnowledgeGraph = updateProductContextMetadata({
    knowledgeGraph: patchedKnowledgeGraph,
    currentState:
      state.plan.status === "supplement" ? "refining" : "building",
    descriptionEntry: createExecutorDescriptionEntry(task, result),
  });
  // Executor 只输出本任务结果，知识图谱归档交给批次 barrier 处理。
  writer?.({
    type: "agent-output",
    agentType: result.agent_type,
    content: formatExecutorResultBlock(result),
  });
  writer?.({
    type: "agent-status",
    agentType: result.agent_type,
    status: "completed",
    phase: "execution",
    parallelAgents,
    taskId: result.task_id,
  });

  return { executorResults: [result], knowledgeGraph: nextKnowledgeGraph };
}

/**
 * 执行 Critique Agent 收尾阶段，审查 Executor 结果并生成待用户确认的更新。
 */
async function executeCritiqueAgentReview(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
): Promise<Partial<WorkflowGraphStateValue>> {
  if (!state.requestAnalysis || !state.plan) return {};

  const writer = getWriter(config);
  const knowledgeGraph =
    state.knowledgeGraph ?? createProductWorkflowKnowledgeGraph();
  writer?.({
    type: "agent-status",
    agentType: "critique",
    status: "started",
    phase: "review",
  });
  const workflowResult = await consumeProductWorkflowStream(
    streamCritiqueAgent({
      modelProfile: getModelProfileFromRunnableConfig(config),
      workspaceId: state.workspaceId,
      productContext: state.productContext,
      requestAnalysis: state.requestAnalysis,
      plan: state.plan,
      executorResults: state.executorResults,
      knowledgeGraph,
      priorIssues: state.priorCritiqueIssues,
      userInput: state.userInput,
      documentEvidenceResolution: isDocumentEvidenceSupplement(
        state.supplementSourceTaskIds,
      ),
      signal: config?.signal,
    }),
    writer,
  );
  const reviewResult = requireMissingInputConfirmation(
    workflowResult,
    state.originalUserInput,
  );
  const reviewedKnowledgeGraph = updateProductContextMetadata({
    knowledgeGraph: reviewResult.knowledge_graph_update,
    currentState:
      reviewResult.status === "completed" ? "stable" : "refining",
    descriptionEntry: createCritiqueDescriptionEntry(reviewResult),
  });
  const nextWorkflowResult: ProductWorkflowResult = {
    ...reviewResult,
    knowledge_graph_update: reviewedKnowledgeGraph,
  };

  // Critique Agent 的完整审查结果用于持久化 request_form 和生成确认表单。
  writer?.({
    type: "agent-output",
    agentType: "critique",
    content: formatProductWorkflowBlock(nextWorkflowResult),
  });
  writer?.({
    type: "agent-status",
    agentType: "critique",
    status: "completed",
    phase: "review",
  });
  writer?.({
    type: "knowledge-graph-update",
    knowledgeGraph: reviewedKnowledgeGraph,
  });

  if (shouldAutomaticallyPlanCorrection(nextWorkflowResult, state)) {
    const correctionInput = createAutomaticCorrectionUserInput(
      nextWorkflowResult,
      state.originalUserInput,
      state.userInput,
    );
    const priorCritiqueIssues = [
      ...(nextWorkflowResult.review.issues ?? []),
      ...(nextWorkflowResult.knowledge_graph_review?.issues ?? []),
    ];
    const retryTaskIds = nextWorkflowResult.review.retry_task_ids ?? [];
    const supplementSourceTaskIds = isDocumentEvidenceSupplement(
      state.supplementSourceTaskIds,
    )
      ? [...new Set([...state.supplementSourceTaskIds, ...retryTaskIds])]
      : retryTaskIds;
    const supplementAffectedTaskIds = inferSupplementAffectedTaskIds(
      supplementSourceTaskIds,
      state.plan,
      reviewedKnowledgeGraph,
    );
    const planningResult = await orchestratorAgentNode(
      {
        ...state,
        userInput: correctionInput,
        plan: null,
        orchestratorDecision: null,
        executorResults: [],
        knowledgeGraph: reviewedKnowledgeGraph,
        priorCritiqueIssues,
        productWorkflow: null,
        supplementAgentTypes: EXECUTOR_DEFINITIONS.map(
          (definition) => definition.agentType,
        ),
        supplementSourceTaskIds,
        supplementAffectedTaskIds,
      },
      config,
    );

    return {
      ...planningResult,
      userInput: correctionInput,
      executorResults: [],
      priorCritiqueIssues,
      productWorkflow: null,
      supplementAgentTypes: EXECUTOR_DEFINITIONS.map(
        (definition) => definition.agentType,
      ),
      supplementSourceTaskIds,
      supplementAffectedTaskIds,
    };
  }

  writer?.({ type: "complete", result: nextWorkflowResult });

  return {
    productWorkflow: nextWorkflowResult,
    knowledgeGraph: reviewedKnowledgeGraph,
  };
}

/**
 * 判断 Critique 缺口是否可在无需用户输入时自动进入一次补充规划。
 */
export function shouldAutomaticallyPlanCorrection(
  workflowResult: ProductWorkflowResult,
  state: Pick<WorkflowGraphStateValue, "userInput">,
): boolean {
  return (
    (workflowResult.review.retry_task_ids?.length ?? 0) > 0 &&
    workflowResult.proposal_questions.length === 0 &&
    !workflowResult.knowledge_graph_update.open_questions.some(
      (question) => question.blocking,
    ) &&
    !state.userInput.some((item) =>
      item.content.includes(AUTOMATIC_CRITIQUE_CORRECTION_MARKER),
    )
  );
}

/**
 * 将 Critique 的确定性缺口转换为 Planner 可消费的自动修正输入。
 */
function createAutomaticCorrectionInput(
  workflowResult: ProductWorkflowResult,
): string {
  const issues = [
    ...(workflowResult.review.issues ?? []),
    ...(workflowResult.knowledge_graph_review?.issues ?? []),
  ];
  return [
    AUTOMATIC_CRITIQUE_CORRECTION_MARKER,
    "Create a supplement DAG that corrects the deterministic Critique issues below. Do not ask the user unless a genuinely blocking product decision is missing.",
    `Retry tasks: ${workflowResult.review.retry_task_ids?.join(", ") || "none"}`,
    ...issues.map(
      (issue) =>
        `- ${issue.code}${issue.task_id ? ` (${issue.task_id})` : ""}: ${issue.message}`,
    ),
  ].join("\n");
}

/**
 * 合并原始输入、当前表单答案和自动修正指令，原始输入索引始终保持稳定。
 */
export function createAutomaticCorrectionUserInput(
  workflowResult: ProductWorkflowResult,
  originalUserInput: UserInputRecord[],
  currentUserInput: UserInputRecord[],
): UserInputRecord[] {
  const records = originalUserInput.map((item) => ({ ...item }));
  const seenContent = new Set(records.map((item) => item.content.trim()));
  let nextIndex = Math.max(0, ...records.map((item) => item.index)) + 1;

  for (const item of currentUserInput) {
    const content = item.content.trim();
    if (!content || seenContent.has(content)) continue;
    records.push({ ...item, index: nextIndex++ });
    seenContent.add(content);
  }

  records.push({
    index: nextIndex,
    type: "自动审查修正",
    content: createAutomaticCorrectionInput(workflowResult),
  });
  return records;
}

/**
 * Critique 只给出输入序号但历史中没有原文时，转为明确的用户确认而不是让 Planner 猜测。
 */
export function requireMissingInputConfirmation(
  workflowResult: ProductWorkflowResult,
  originalUserInput: UserInputRecord[],
): ProductWorkflowResult {
  const availableIndexes = new Set(
    originalUserInput.map((item) => item.index),
  );
  const issues = [
    ...(workflowResult.review.issues ?? []),
    ...(workflowResult.knowledge_graph_review?.issues ?? []),
  ];
  const missingIndexes = [
    ...new Set(
      issues.flatMap((issue) => {
        const match = issue.message.match(/user input\s+(\d+)/i);
        const index = match ? Number(match[1]) : NaN;
        return Number.isInteger(index) && !availableIndexes.has(index)
          ? [index]
          : [];
      }),
    ),
  ];
  if (missingIndexes.length === 0) return workflowResult;

  return {
    ...workflowResult,
    status: "pending_user_confirmation",
    proposal_questions: [
      ...workflowResult.proposal_questions,
      ...missingIndexes.map((index) => {
        const referencedIssue = issues.find((issue) =>
          new RegExp(`user input\\s+${index}\\b`, "i").test(issue.message),
        );
        const sourceTask =
          workflowResult.planner.tasks.find(
            (task) => task.task_id === referencedIssue?.task_id,
          ) ?? workflowResult.planner.tasks[0]!;
        return {
          id: `missing-user-input-${index}`,
          label: `无法恢复原始输入 ${index}，请重新提供该项约束的具体内容。`,
          type: "textarea" as const,
          required: true,
          help: "缺少原文时系统不会自动推断需求。",
          source_task_id: sourceTask.task_id,
          source_agent: sourceTask.assigned_agent,
          sources: [
            {
              source_task_id: sourceTask.task_id,
              source_agent: sourceTask.assigned_agent,
            },
          ],
          priority: 100,
        };
      }),
    ],
    confirmation_message:
      "部分原始用户输入无法恢复，请重新提供具体内容后再继续自动修正。",
  };
}

/**
 * 生成 Orchestrator 写入产品上下文 description 的业务摘要。
 */
function createOrchestratorDescriptionEntry(
  decision: OrchestratorAgentOutput["decision"],
  plan: OrchestratorAgentOutput["plan"],
): string {
  if (!plan) {
    return `Orchestrator Agent routed this turn as ${decision.intent} and did not create an execution DAG.`;
  }

  const currentState =
    plan.status === "supplement" ? "refining" : "building";
  return `Orchestrator Agent routed this turn as ${decision.intent}, generated a ${plan.status} DAG with ${plan.tasks.length} executor tasks, and moved the product context into ${currentState}.`;
}

/**
 * 判断当前输入是否是用户确认后的补充轮次。
 */
export function isSupplementWorkflow(
  state: WorkflowGraphStateValue,
): boolean {
  return (
    (state.supplementAgentTypes?.length ?? 0) > 0 ||
    state.userInput.some((item) =>
      /\[form answers - [^\]]+\]/i.test(item.content),
    )
  );
}

/**
 * 生成 Executor 写入产品上下文 description 的业务摘要。
 */
function createExecutorDescriptionEntry(
  task: TaskExecutionNode,
  result: ProductWorkflowResult["executor_results"][number],
): string {
  return `${result.agent_type} completed ${task.task_id} (${task.title}) and updated product context with: ${result.summary}`;
}

/**
 * 生成 Critique 写入产品上下文 description 的业务摘要。
 */
function createCritiqueDescriptionEntry(
  workflowResult: ProductWorkflowResult,
): string {
  const retryTaskIds = workflowResult.review.retry_task_ids ?? [];
  if (workflowResult.status === "completed") {
    return `Critique Agent accepted the DAG result and marked the product context stable: ${workflowResult.review.notes}`;
  }

  return `Critique Agent found follow-up work or user confirmation needs, marked the product context refining, and identified retry tasks: ${retryTaskIds.join(", ") || "none"}.`;
}

/**
 * 消费子 Agent 的流式事件，并保留 async generator 的最终结构化返回值。
 */
async function consumeProductWorkflowStream<T>(
  stream: AsyncGenerator<ProductWorkflowStreamEvent, T, void>,
  writer: ((chunk: unknown) => void) | undefined,
  options: { parallelAgents?: ExecutorAgentType[] } = {},
): Promise<T> {
  let next = await stream.next();
  while (!next.done) {
    writer?.(withParallelAgents(next.value, options.parallelAgents));
    next = await stream.next();
  }
  return next.value;
}

/**
 * 将当前并行批次信息补到 Executor token 事件，供前端 token 用量展示并行提示。
 */
function withParallelAgents(
  event: ProductWorkflowStreamEvent,
  parallelAgents?: ExecutorAgentType[],
): ProductWorkflowStreamEvent {
  if (
    event.type !== "token-usage" ||
    !parallelAgents ||
    parallelAgents.length <= 1
  ) {
    return event;
  }

  return {
    ...event,
    parallelAgents,
  };
}

/**
 * 找出指定 Executor Agent 当前可以执行的第一个 DAG 任务。
 */
function findNextExecutableTaskForAgent(
  state: WorkflowGraphStateValue,
  agentType: ExecutorAgentType,
) {
  if (!state.plan) return null;

  const completedTaskIds = new Set(
    state.executorResults.map((result) => result.task_id),
  );
  return (
    state.plan.tasks
    .filter((task) => task.assigned_agent === agentType)
    .sort((left, right) => left.sequence - right.sequence)
    .find((task) => {
      if (completedTaskIds.has(task.task_id)) return false;
      return task.depends_on.every((taskId) => completedTaskIds.has(taskId));
    }) ?? null
  );
}

/**
 * 读取当前 Router 会同时调度的 Executor 集合，用于前端并行运行态展示。
 */
function getCurrentParallelExecutorAgents(
  state: WorkflowGraphStateValue,
): ExecutorAgentType[] {
  const targets = selectNextExecutorRouterTargets(state);
  if (!Array.isArray(targets)) return [];

  return targets.filter(isExecutorAgentType);
}

/**
 * 根据 Planner DAG 和已完成结果选择下一个 LangGraph Executor 节点。
 */
export function selectNextProductWorkflowNode(
  state: WorkflowGraphStateValue,
): string {
  const nextNodes = selectNextExecutorRouterTargets(state);
  return Array.isArray(nextNodes) ? nextNodes[0] ?? "end" : nextNodes;
}

/**
 * 根据 DAG 依赖选择下一批可并行运行的 Executor 节点。
 */
export function selectNextExecutorRouterTargets(
  state: WorkflowGraphStateValue,
): string | string[] {
  if (state.productWorkflow || !state.plan) return "end";

  const completedTaskIds = new Set(
    state.executorResults.map((result) => result.task_id),
  );
  const incompleteTasks = state.plan.tasks
    .filter((task) => !completedTaskIds.has(task.task_id))
    .sort((left, right) => left.sequence - right.sequence);

  if (incompleteTasks.length === 0) return "orchestrator_agent";

  const readyTasks = incompleteTasks.filter((task) =>
    task.depends_on.every((taskId) => completedTaskIds.has(taskId)),
  );
  const parallelTasks = packParallelExecutorTasks(readyTasks);
  if (parallelTasks.length === 0) return "orchestrator_agent";

  return parallelTasks.map((task) => task.assigned_agent);
}

/**
 * 兼容旧命名：Executor Router 的条件边目标选择器。
 */
export const selectNextProductWorkflowNodes = selectNextExecutorRouterTargets;

/**
 * 判断 Planner DAG 中的任务是否已经全部由 Executor 回写结果。
 */
function arePlanTasksFinished(state: WorkflowGraphStateValue): boolean {
  if (!state.plan) return false;

  const completedTaskIds = new Set(
    state.executorResults.map((result) => result.task_id),
  );
  return state.plan.tasks.every((task) => completedTaskIds.has(task.task_id));
}

/**
 * 同一批只保留每个 Executor 的最早任务，避免同一节点被重复调度。
 */
function packParallelExecutorTasks(
  tasks: TaskExecutionNode[],
): TaskExecutionNode[] {
  const selected = new Map<ExecutorAgentType, TaskExecutionNode>();

  for (const task of tasks.sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    if (!isExecutorAgentType(task.assigned_agent)) continue;
    if (selected.has(task.assigned_agent)) continue;
    selected.set(task.assigned_agent, task);
  }

  return [...selected.values()];
}
