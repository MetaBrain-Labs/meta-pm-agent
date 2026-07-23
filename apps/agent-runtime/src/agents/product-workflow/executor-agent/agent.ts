/**
 * Executor Agent 实现
 *
 * 单个 Executor Agent 的流式执行器，负责接收 Planner 分配的任务、
 * 读取当前知识图谱结构化状态、通过工具维护图谱数据，并输出任务结果和推理过程。
 * 从强类型结构化工具调用的 args 中收集 entities/relations/decisions/risks/questions
 * 数据，填充到 ExecutorAgentResult。
 *
 * Responsibilities:
 * - streamExecutorAgent()：执行单个任务并产出结构化图谱补丁
 * - 根据 task.assigned_agent 查找对应 ExecutorDefinition 配置
 * - 为 Executor 附加知识图谱工具（基于内存状态对象，不写文件）
 * - 使用 runAgent 通用执行器并解析文本输出
 * - 从 tool-call 事件中收集结构化数据填充 ExecutorAgentResult
 *
 * Notes:
 * - 每个 Executor 只处理分配给自己的任务，不跨越职责边界
 * - 知识图谱状态通过对象引用在工具间共享，工具调用会直接变更该引用
 */

import {
  type ExecutorAgentResult,
  type TaskExecutionNode,
  type KnowledgeGraphEntity,
  type KnowledgeGraphRelation,
  type KnowledgeGraphDecisionInput,
  type KnowledgeGraphRiskInput,
  type KnowledgeGraphOpenQuestionInput,
  type ProductKnowledgeGraph,
} from "@repo/shared";
import {
  type AgentRunEvent,
  TEXT_AGENT_MODEL_OPTIONS,
  resolveTextOutput,
  runAgent,
} from "../../common/run-agent";
import {
  createToolsForAgent,
  getExecutorDefaultToolNames,
  getExecutorRetryToolNames,
} from "../../common/tool-access";
import {
  createGraphContextSummary,
  createTaskRelevantGraphContext,
} from "../common/context";
import type { ExecutorAgentInput, ProductWorkflowStreamEvent } from "../types";
import {
  getExecutorDefinition,
  isExecutorAgentType,
  type ExecutorAgentType,
} from "./definitions";
import { createExecutorAgentPrompt } from "./prompt";

/**
 * 强类型结构化工具名称集合，用于识别需要从中收集数据的工具调用。
 */
const STRUCTURED_TOOL_NAMES = new Set([
  "kg_file_add_nodes",
  "kg_file_add_relations",
  "kg_file_add_decisions",
  "kg_file_add_risks",
  "kg_file_add_open_questions",
]);

const BLOCKER_TOOL_NAME = "kg_file_raise_blocker";

/**
 * Executor 上报的硬阻塞信息，用于由 Conversation Agent 释放 HITL 表单。
 */
export interface ExecutorHumanInputRequired {
  taskId: string;
  agentType: ExecutorAgentType;
  displayName: string;
  category: "hard_conflict" | "runtime_error";
  title: string;
  details: string;
  neededUserInput: string;
}

/**
 * 表示 Executor 当前任务必须等待用户补充信息后才能继续。
 */
export class ExecutorHumanInputRequiredError extends Error {
  readonly interrupt: ExecutorHumanInputRequired;

  constructor(interrupt: ExecutorHumanInputRequired) {
    super(`${interrupt.displayName} requires human input: ${interrupt.title}`);
    this.name = "ExecutorHumanInputRequiredError";
    this.interrupt = interrupt;
  }
}

/**
 * 判断异常是否为 Executor 主动触发的人审阻塞。
 */
export function isExecutorHumanInputRequiredError(
  error: unknown,
): error is ExecutorHumanInputRequiredError {
  return error instanceof ExecutorHumanInputRequiredError;
}

/**
 * Executor Agent：读取当前知识图谱结构化状态并产出本任务的图谱补丁。
 */
export async function* streamExecutorAgent(
  input: ExecutorAgentInput,
): AsyncGenerator<ProductWorkflowStreamEvent, ExecutorAgentResult, void> {
  const definition = getExecutorDefinition(
    assertExecutorAgentType(input.task.assigned_agent),
  );

  yield {
    type: "reasoning",
    agentType: definition.agentType,
    content: `${definition.displayName} 正在读取知识图谱状态并准备图谱补丁。\n`,
  };
  // 工具在本轮工作副本上写入，外层节点统一用 appendKnowledgeGraphPatch 合并一次。
  const baseKnowledgeGraph = cloneKnowledgeGraph(input.knowledgeGraph);
  const toolKnowledgeGraph = cloneKnowledgeGraph(input.knowledgeGraph);
  // 手动迭代生成器以在透传事件给上游的同时收集结构化数据。
  let patch = "";
  let retryInstruction = "";
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      // 重试时基于同一工作副本继续执行，保留首次已完成的工具写入。
      const graphContextSummary = createGraphContextSummary(toolKnowledgeGraph);
      const recentNodeIds = new Set(
        graphContextSummary.recent_nodes.map((node) => node.id),
      );
      const taskRelevantContext = createTaskRelevantGraphContext({
        knowledgeGraph: toolKnowledgeGraph,
        task: input.task,
        previousResults: input.previousResults,
        excludeNodeIds: recentNodeIds,
      });
      const tools = createToolsForAgent(
        definition.agentType,
        attempt > 1
          ? getExecutorRetryToolNames()
          : getExecutorDefaultToolNames(definition.agentType),
        {
          knowledgeGraph: toolKnowledgeGraph,
          allowedEntityTypes: definition.allowedEntityTypes,
          allowedRelationTypes: definition.allowedRelationTypes,
          requiredBlockingOpenQuestionCount:
            input.task.required_open_question_count ?? 0,
        },
      );
      const textGen = runAgent({
        agentType: definition.agentType,
        agentLabel: definition.displayName,
        name: `${definition.agentType}-agent${attempt > 1 ? "-retry" : ""}`,
        modelOptions: {
          ...TEXT_AGENT_MODEL_OPTIONS,
          maxTokens: 16384,
          timeout: 60_000,
        },
        systemPrompt: createExecutorAgentPrompt(definition),
        tools,
        skills: getExecutorSkillSources(
          definition,
          input.plan.status === "supplement",
        ),
        payload: {
          product_context:
            input.productContext?.slice(0, 800) ||
            "No product context provided.",
          graph_context_summary: graphContextSummary,
          task_relevant_context: taskRelevantContext,
          task: input.task,
          ...(attempt > 1
            ? {
                retry_instruction: retryInstruction,
              }
            : {}),
        },
        resolveOutput: resolveTextOutput,
        fallback: () => createFallbackKnowledgeGraphPatch(input.task),
        signal: input.signal,
        throwOnError: true,
      });

      let genResult = await textGen.next();
      while (!genResult.done) {
        const event = genResult.value as AgentRunEvent<string>;

        yield event as ProductWorkflowStreamEvent;
        if (
          event.type === "tool-result" &&
          event.toolName === BLOCKER_TOOL_NAME
        ) {
          throw createHumanInputRequiredError({
            task: input.task,
            agentType: definition.agentType,
            displayName: definition.displayName,
            toolResult: event.toolResult,
          });
        }
        if (
          event.type === "tool-result" &&
          STRUCTURED_TOOL_NAMES.has(event.toolName)
        ) {
          // 结构化写入工具完成后立即发出累计图谱快照，避免后续中断丢失已完成工具产物。
          yield {
            type: "knowledge-graph-update",
            knowledgeGraph: cloneKnowledgeGraph(toolKnowledgeGraph),
          };
        }
        genResult = await textGen.next();
      }
      patch = genResult.value;

      const attemptDelta = getKnowledgeGraphDelta(
        baseKnowledgeGraph,
        toolKnowledgeGraph,
      );
      const requiredBlockingCount =
        input.task.required_open_question_count ?? 0;
      const blockingQuestionCount = attemptDelta.open_questions.filter(
        (question) => question.blocking,
      ).length;
      const hasStructuredItems = hasStructuredGraphItems(attemptDelta);
      if (
        (hasStructuredItems &&
          blockingQuestionCount >= requiredBlockingCount) ||
        attempt === 2
      ) {
        if (blockingQuestionCount < requiredBlockingCount) {
          throw new Error(
            `Executor output validation failed after retry: required ${requiredBlockingCount} blocking open questions, committed ${blockingQuestionCount}.`,
          );
        }
        break;
      }

      retryInstruction = [
        "The previous attempt failed executor output validation. This is the only retry and exposes write tools only; do not repeat research or analysis.",
        !hasStructuredItems
          ? "Write the minimum required graph items immediately."
          : "",
        blockingQuestionCount < requiredBlockingCount
          ? `Persist at least ${requiredBlockingCount} new open questions with blocking=true in one kg_file_add_open_questions call; currently ${blockingQuestionCount} are committed.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      yield {
        type: "reasoning",
        agentType: definition.agentType,
        content: `${definition.displayName} 的结构化产出未满足任务契约，正在原地修正一次。\n`,
      };
    }
  } catch (error) {
    if (isExecutorHumanInputRequiredError(error)) {
      throw error;
    }
    if (isAbortError(error)) {
      throw error;
    }
    throw new ExecutorHumanInputRequiredError({
      taskId: input.task.task_id,
      agentType: definition.agentType,
      displayName: definition.displayName,
      category: "runtime_error",
      title: "Executor runtime error",
      details: compactErrorMessage(getErrorMessage(error)),
      neededUserInput:
        "请确认是否重试该 Executor，并补充任何可以帮助绕过当前程序错误或约束冲突的信息。",
    });
  }
  const graphDelta = getKnowledgeGraphDelta(
    baseKnowledgeGraph,
    toolKnowledgeGraph,
  );

  return createExecutorResult({
    task: input.task,
    agentType: definition.agentType,
    focusLayer: definition.focusLayer,
    displayName: definition.displayName,
    patch,
    summary: createExecutorSummary(
      definition.displayName,
      input.task,
      graphDelta,
    ),
    entities: graphDelta.entities,
    relations: graphDelta.relations,
    decisions: graphDelta.decisions,
    risks: graphDelta.risks,
    openQuestions: graphDelta.open_questions,
  });
}

/**
 * 根据真实结构化增量生成可信摘要，避免模型摘要与最终落图数量不一致。
 */
function createExecutorSummary(
  displayName: string,
  task: TaskExecutionNode,
  delta: ReturnType<typeof getKnowledgeGraphDelta>,
): string {
  const blockingQuestionCount = delta.open_questions.filter(
    (question) => question.blocking,
  ).length;
  return `${displayName} completed ${task.title}: ${delta.entities.length} entities, ${delta.relations.length} relations, ${delta.decisions.length} decisions, ${delta.risks.length} risks, and open questions: ${delta.open_questions.length} total / ${blockingQuestionCount} blocking.`;
}

/**
 * 从硬阻塞工具结果构造 workflow 可捕获的人审异常。
 */
function createHumanInputRequiredError({
  task,
  agentType,
  displayName,
  toolResult,
}: {
  task: TaskExecutionNode;
  agentType: ExecutorAgentType;
  displayName: string;
  toolResult: unknown;
}): ExecutorHumanInputRequiredError {
  const blocker = parseBlockerToolResult(toolResult);
  return new ExecutorHumanInputRequiredError({
    taskId: task.task_id,
    agentType,
    displayName,
    category: blocker.category,
    title: blocker.title,
    details: blocker.details,
    neededUserInput: blocker.needed_user_input,
  });
}

/**
 * 解析硬阻塞工具输出，兼容字符串 JSON 和对象结果。
 */
function parseBlockerToolResult(toolResult: unknown): {
  category: "hard_conflict" | "runtime_error";
  title: string;
  details: string;
  needed_user_input: string;
} {
  const parsed =
    typeof toolResult === "string" ? parseJsonObject(toolResult) : toolResult;
  const firstItem =
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as Record<string, unknown>).items)
      ? (parsed as { items: unknown[] }).items[0]
      : null;
  const record =
    firstItem && typeof firstItem === "object"
      ? (firstItem as Record<string, unknown>)
      : {};
  const category =
    record.category === "runtime_error" ? "runtime_error" : "hard_conflict";

  return {
    category,
    title: compactErrorMessage(
      getStringField(record, "title") || "Executor hard blocker",
      120,
    ),
    details: compactErrorMessage(
      getStringField(record, "details") ||
        "Executor reported a hard blocker without additional details.",
    ),
    needed_user_input: compactErrorMessage(
      getStringField(record, "needed_user_input") ||
        "请补充能够解除该阻塞的信息。",
    ),
  };
}

/**
 * 压缩面向用户展示的异常文本，避免把堆栈、长 JSON 或 provider 细节整段塞进确认表单。
 */
function compactErrorMessage(message: string, maxLength = 240): string {
  const firstMeaningfulLine =
    message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("at ")) ?? message.trim();
  const compacted = firstMeaningfulLine.replace(/\s+/g, " ");
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength).trimEnd()}...`
    : compacted;
}

/**
 * 安全解析工具返回的 JSON 文本。
 */
function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 从未知记录中读取字符串字段。
 */
function getStringField(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 提取运行时异常的可展示文本。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 保留用户主动停止的 AbortError 语义，避免被包装为 HITL。
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * 将 Executor profile 中的技能名映射到 references 下的 DeepAgents skill source 目录。
 */
function getExecutorSkillSources(definition: {
  agentType: ExecutorAgentType;
  referencePath: string;
  skills: readonly string[];
}, supplement = false): string[] {
  const skillNames =
    supplement && definition.agentType === "executor-product-strategy"
      ? definition.skills.filter((skillName) => skillName === "product-strategy")
      : definition.skills;
  return skillNames.map(
    (skillName) => `${definition.referencePath}/skills/${skillName}`,
  );
}

/**
 * 生成稳定的 Executor 执行结果，供 DAG 状态和持久化层使用。
 */
function createExecutorResult({
  task,
  agentType,
  focusLayer,
  displayName,
  patch,
  summary,
  entities,
  relations,
  decisions,
  risks,
  openQuestions,
}: {
  task: TaskExecutionNode;
  agentType: ExecutorAgentType;
  focusLayer: ExecutorAgentResult["focus_layer"];
  displayName: string;
  patch: string;
  summary?: string;
  entities: KnowledgeGraphEntity[];
  relations: KnowledgeGraphRelation[];
  decisions: KnowledgeGraphDecisionInput[];
  risks: KnowledgeGraphRiskInput[];
  openQuestions: KnowledgeGraphOpenQuestionInput[];
}): ExecutorAgentResult {
  return {
    task_id: task.task_id,
    agent_type: agentType,
    focus_layer: focusLayer,
    summary: summary?.trim() || `${displayName} 已更新至知识图谱。`,
    entities,
    relations,
    decisions: decisions.length > 0 ? decisions : [],
    risks: risks.length > 0 ? risks : [],
    open_questions: openQuestions.length > 0 ? openQuestions : [],
    quality_result: {
      passed: true,
      notes: "Executor 产出已作为结构化补丁写入当前知识图谱状态。",
    },
    knowledge_graph_patch: patch,
  };
}

/**
 * 克隆当前知识图谱，供单个 Executor 内部工具读取和写入，避免工具副作用污染全局状态。
 */
function cloneKnowledgeGraph(
  knowledgeGraph: ProductKnowledgeGraph,
): ProductKnowledgeGraph {
  return {
    entities: [...knowledgeGraph.entities],
    relations: [...knowledgeGraph.relations],
    decisions: [...knowledgeGraph.decisions],
    risks: [...knowledgeGraph.risks],
    open_questions: [...knowledgeGraph.open_questions],
    summary: [...knowledgeGraph.summary],
    markdown: knowledgeGraph.markdown,
    notes: [...knowledgeGraph.notes],
  };
}

/**
 * 从工具工作副本中计算本轮 Executor 实际写入的结构化增量。
 */
function getKnowledgeGraphDelta(
  base: ProductKnowledgeGraph,
  current: ProductKnowledgeGraph,
): Pick<
  ProductKnowledgeGraph,
  | "entities"
  | "relations"
  | "decisions"
  | "risks"
  | "open_questions"
  | "summary"
> {
  return {
    entities: current.entities.slice(base.entities.length),
    relations: current.relations.slice(base.relations.length),
    decisions: current.decisions.slice(base.decisions.length),
    risks: current.risks.slice(base.risks.length),
    open_questions: current.open_questions.slice(base.open_questions.length),
    summary: current.summary.slice(base.summary.length),
  };
}

/**
 * 判断 Executor 是否已经产生 Critique 可验证的结构化图谱增量。
 */
export function hasStructuredGraphItems(
  delta: Pick<
    ProductKnowledgeGraph,
    "entities" | "relations" | "decisions" | "risks" | "open_questions"
  >,
): boolean {
  return (
    delta.entities.length > 0 ||
    delta.relations.length > 0 ||
    delta.decisions.length > 0 ||
    delta.risks.length > 0 ||
    delta.open_questions.length > 0
  );
}

/**
 * 在模型不可用时生成最小可追踪的结构化图谱补丁。
 */
function createFallbackKnowledgeGraphPatch(task: TaskExecutionNode): string {
  return JSON.stringify(
    {
      summary: [task.title],
      nodes: [
        {
          id: `${task.task_id}-placeholder`,
          type: "Custom",
          name: task.title,
          description: task.description,
          source_task_id: task.task_id,
          status: "proposed",
        },
      ],
      relations: [],
      decisions: [],
      risks: [
        {
          id: `${task.task_id}-risk-01`,
          text: "模型不可用，本任务只写入最小占位节点。",
        },
      ],
      open_questions: [
        {
          id: `${task.task_id}-oq-01`,
          text: "是否接受该任务的图谱建模方向？",
          blocking: true,
        },
      ],
    },
    null,
    2,
  );
}

/**
 * 保护运行时分派边界，避免 Planner 输出未知 Agent 类型时静默进入错误节点。
 */
function assertExecutorAgentType(agentType: string): ExecutorAgentType {
  if (isExecutorAgentType(agentType)) return agentType;
  throw new Error(`Unknown executor agent type: ${agentType}`);
}
