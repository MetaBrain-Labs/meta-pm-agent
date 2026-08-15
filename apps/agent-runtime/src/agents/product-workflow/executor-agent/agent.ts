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
  type AgentRuntimeTool,
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
import { createWebSearchEvidenceRegistry } from "../../common/web-search-tool";
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
import { createExecutorSkillBundle } from "./skills";

/**
 * 强类型结构化工具名称集合，用于识别需要从中收集数据的工具调用。
 */
const STRUCTURED_TOOL_NAMES = new Set([
  "kg_file_add_nodes",
  "kg_file_deprecate_nodes",
  "kg_file_add_relations",
  "kg_file_add_decisions",
  "kg_file_add_risks",
  "kg_file_add_open_questions",
]);
const STRUCTURED_WRITE_FAILURE_PREFIXES = [
  "unauthorized_entity_type:",
  "unauthorized_relation_type:",
  "invalid_relation_direction:",
  "missing_relation_",
  "missing_deprecation_target",
  "missing_active_replacement_node",
  "source_task_id_mismatch",
] as const;

const BLOCKER_TOOL_NAME = "kg_file_raise_blocker";
const REQUIRED_STRUCTURED_WRITE_ERROR =
  "required-structured-write-not-invoked";
export const EXECUTOR_CORRECTION_TOOL_CALL_LIMIT = 8;

/**
 * 判断当前调用是否为受限修正尝试；手动重试从第一次调用起即属于修正模式。
 */
export function isExecutorCorrectionAttempt(
  attempt: number,
  externalCorrection: boolean,
): boolean {
  return externalCorrection || attempt > 1;
}

/** 外部确认的修正本身已经是修正机会，不再嵌套第二次模型重试。 */
export function getExecutorMaxAttempts(externalCorrection: boolean): number {
  return externalCorrection ? 1 : 2;
}

/** 纯孤立证据修正禁止创建节点，但保留关系写入和受控废弃能力。 */
export function restrictExecutorCorrectionToolNames(
  toolNames: AgentRuntimeTool[],
  forbidNewEvidence: boolean,
): AgentRuntimeTool[] {
  return forbidNewEvidence
    ? toolNames.filter((toolName) => toolName !== "kg_file_add_nodes")
    : toolNames;
}

/**
 * 判断失败是否还能通过原任务重放修复；历史 OpenQuestion 缺失可由新增幂等关闭能力修复。
 */
export function isSameTaskExecutorRetryable(details: string): boolean {
  if (!details.includes("missing_deprecation_target")) return true;

  const missingTargetIds = [
    ...details.matchAll(
      /(?:^|[\s,])([^,:\s]+):missing_deprecation_target(?=$|[\s,])/g,
    ),
  ].map((match) => match[1]);
  return (
    missingTargetIds.length > 0 &&
    missingTargetIds.every((targetId) => targetId?.startsWith("OQ-"))
  );
}

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
 * 表示 Executor 已完成一次本地修正，但仍存在只能由后续 Executor 重试解决的运行时错误。
 */
export class ExecutorRetryRequiredError extends Error {
  readonly taskId: string;
  readonly agentType: ExecutorAgentType;
  readonly displayName: string;
  readonly details: string;

  /**
   * 保留完整错误文本，由前端负责预览截断和详情展示。
   */
  constructor(input: {
    taskId: string;
    agentType: ExecutorAgentType;
    displayName: string;
    details: string;
  }) {
    super(input.details);
    this.name = "ExecutorRetryRequiredError";
    this.taskId = input.taskId;
    this.agentType = input.agentType;
    this.displayName = input.displayName;
    this.details = input.details;
  }
}

/**
 * 判断异常是否应交由 Executor 重试，而不是请求用户补充信息。
 */
export function isExecutorRetryRequiredError(
  error: unknown,
): error is ExecutorRetryRequiredError {
  return error instanceof ExecutorRetryRequiredError;
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
  const skillBundle = await createExecutorSkillBundle(
    definition,
    input.plan.status === "supplement",
  );

  yield {
    type: "reasoning",
    agentType: definition.agentType,
    content: `${definition.displayName} 正在读取知识图谱状态并准备图谱补丁。\n`,
  };
  // 工具在本轮工作副本上写入，外层节点统一用 appendKnowledgeGraphPatch 合并一次。
  const baseKnowledgeGraph = cloneKnowledgeGraph(input.knowledgeGraph);
  const toolKnowledgeGraph = cloneKnowledgeGraph(input.knowledgeGraph);
  const webSearchEvidenceRegistry = createWebSearchEvidenceRegistry();
  // 手动迭代生成器以在透传事件给上游的同时收集结构化数据。
  let patch = "";
  let retryInstruction =
    input.retryInstruction ?? input.correctionInstruction ?? "";
  const manualRetry = Boolean(input.retryInstruction?.trim());
  const critiqueCorrection = Boolean(input.correctionInstruction?.trim());
  const externalCorrection = manualRetry || critiqueCorrection;
  const maxAttempts = getExecutorMaxAttempts(externalCorrection);
  // 外部 correction 仍只有一次真实执行机会；仅当第一次完全没有调用写入工具时，
  // 才允许一次不增加工具预算的纯空执行修正。
  const runAttemptLimit = externalCorrection ? maxAttempts + 1 : maxAttempts;
  const attemptErrors: string[] = [];
  const persistedNumericGap =
    input.documentEvidenceResolution && manualRetry
      ? createDocumentEvidenceNumericInputRequired({
          details: retryInstruction,
          task: input.task,
          agentType: definition.agentType,
          displayName: definition.displayName,
          knowledgeGraph: input.knowledgeGraph,
        })
      : null;
  if (persistedNumericGap) throw persistedNumericGap;
  try {
    for (let attempt = 1; attempt <= runAttemptLimit; attempt += 1) {
      // 重试时基于同一工作副本继续执行，保留首次已完成的工具写入。
      const correctionAttempt = isExecutorCorrectionAttempt(
        attempt,
        externalCorrection,
      );
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
      const selectedToolNames = correctionAttempt
        ? getExecutorRetryToolNames(input.plan.status === "supplement")
        : getExecutorDefaultToolNames(
            definition.agentType,
            input.plan.status === "supplement",
          );
      const tools = createToolsForAgent(
        definition.agentType,
        restrictExecutorCorrectionToolNames(
          selectedToolNames,
          input.forbidNewEvidence === true,
        ),
        {
          knowledgeGraph: toolKnowledgeGraph,
          allowedEntityTypes: definition.allowedEntityTypes,
          allowedRelationTypes: definition.allowedRelationTypes,
          requiredBlockingOpenQuestionCount:
            input.task.required_open_question_count ?? 0,
          allowNodeDeprecation: input.plan.status === "supplement",
          allowRiskDeprecation: input.documentEvidenceResolution === true,
          allowOpenQuestionDeprecation: input.plan.status === "supplement",
          sourceTaskId: input.task.task_id,
          userInput: input.userInput,
          webSearchEvidenceRegistry,
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
        modelProfile: input.modelProfile,
        modelGroup: "executors",
        systemPrompt: createExecutorAgentPrompt(definition),
        tools,
        skills: skillBundle.sources,
        skillFiles: skillBundle.files,
        payload: {
          product_context:
            input.productContext?.slice(0, 800) ||
            "No product context provided.",
          graph_context_summary: graphContextSummary,
          task_relevant_context: taskRelevantContext,
          ...(input.correctionTargetNodeIds?.length
            ? {
                correction_target_context: createCorrectionTargetContext(
                  toolKnowledgeGraph,
                  input.correctionTargetNodeIds,
                ),
              }
            : {}),
          user_input: input.userInput,
          valid_user_input_indexes: input.userInput.map((item) => item.index),
          task: input.task,
          ...(retryInstruction
            ? {
                retry_instruction: retryInstruction,
              }
            : {}),
        },
        resolveOutput: resolveTextOutput,
        fallback: () => "",
        suppressFallbackReasoning: true,
        signal: input.signal,
        throwOnError: true,
        requiredSuccessfulToolNames: correctionAttempt
          ? STRUCTURED_TOOL_NAMES
          : undefined,
        toolCallRunLimit: correctionAttempt
          ? EXECUTOR_CORRECTION_TOOL_CALL_LIMIT
          : undefined,
        getToolResultError: getStructuredWriteError,
      });

      try {
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
          genResult = await textGen.next();
        }
        patch = genResult.value;
      } catch (error) {
        if (isExecutorHumanInputRequiredError(error) || isAbortError(error)) {
          throw error;
        }
        attemptErrors.push(getErrorMessage(error));
        const numericInputRequired = input.documentEvidenceResolution
          ? createDocumentEvidenceNumericInputRequired({
              details: error,
              task: input.task,
              agentType: definition.agentType,
              displayName: definition.displayName,
              knowledgeGraph: input.knowledgeGraph,
            })
          : null;
        if (numericInputRequired) throw numericInputRequired;
        if (
          shouldRetryEmptyExternalCorrection(
            externalCorrection,
            attempt,
            error,
          )
        ) {
          retryInstruction = [
            "Your previous correction response called no structured graph write tool.",
            "This is the only no-op correction retry. Call the minimum required write tool immediately; do not describe future work.",
          ].join(" ");
          yield {
            type: "reasoning",
            agentType: definition.agentType,
            content: `${definition.displayName} 未执行任何结构化写入，正在进行唯一一次空执行修正。\n`,
          };
          continue;
        }
        if (
          attempt < maxAttempts &&
          (isNodeProvenanceValidationFailure(error) ||
            isStructuredWriteValidationFailure(error))
        ) {
          retryInstruction = isNodeProvenanceValidationFailure(error)
            ? createNodeProvenanceRetryInstruction(
                error,
                webSearchEvidenceRegistry,
                input.userInput.map((item) => item.index),
              )
            : createStructuredWriteRetryInstruction(error);
          yield {
            type: "reasoning",
            agentType: definition.agentType,
            content: `${definition.displayName} 的来源校验未通过，正在使用本轮真实来源原地修正一次。\n`,
          };
          continue;
        }
        throw error;
      }

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
      const validationError = getExecutorOutputValidationError({
        hasStructuredItems,
        blockingQuestionCount,
        requiredBlockingCount,
      });
      if (!validationError) break;
      if (attempt === maxAttempts) {
        throw new Error(
          `Executor output validation failed after retry: ${validationError}`,
        );
      }

      retryInstruction = createOutputValidationRetryInstruction({
        hasStructuredItems,
        blockingQuestionCount,
        requiredBlockingCount,
      });
      attemptErrors.push(retryInstruction);

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
    if (isAbortError(error) || isExecutorRetryRequiredError(error)) {
      throw error;
    }
    const attemptSummary = formatExecutorAttemptErrors(attemptErrors, error);
    throw new ExecutorRetryRequiredError({
      taskId: input.task.task_id,
      agentType: definition.agentType,
      displayName: definition.displayName,
      details: appendMissingEndpointRecoveryGuidance(
        attemptSummary,
        toolKnowledgeGraph,
      ),
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
 * 为定点修正提供目标节点及其一跳关系，避免 Executor 重复执行全图查询。
 */
function createCorrectionTargetContext(
  knowledgeGraph: ProductKnowledgeGraph,
  targetNodeIds: string[],
) {
  const targetIdSet = new Set(targetNodeIds);
  const relations = knowledgeGraph.relations.filter(
    (relation) =>
      targetIdSet.has(relation.source) || targetIdSet.has(relation.target),
  );
  const relatedIds = new Set([
    ...targetNodeIds,
    ...relations.flatMap((relation) => [relation.source, relation.target]),
  ]);
  return {
    nodes: knowledgeGraph.entities.filter((entity) => relatedIds.has(entity.id)),
    relations,
  };
}

/**
 * 当失败包含缺失关系端点时，在详情中追加确定性的自愈指引与当前图谱实体 ID 样本。
 *
 * 该文本会随持久化错误进入手动重试卡片与 correction 指令，
 * 使重试具备「核实并用正确 ID 改写」的完整信息，不再盲写同一错误端点。
 */
export function appendMissingEndpointRecoveryGuidance(
  details: string,
  knowledgeGraph: ProductKnowledgeGraph,
): string {
  if (!details.includes("missing_relation_endpoint")) return details;
  const knownIds = knowledgeGraph.entities
    .map((entity) => entity.id)
    .slice(0, 20);
  return [
    details,
    `Known entity ID sample from the current graph (first ${knownIds.length}): ${knownIds.join(", ") || "(empty)"}`,
    "On retry, verify referenced IDs with kg_file_query_nodes and use the exact persisted IDs from the graph; if a node must be created first, create it and use its returned ID.",
  ].join("\n");
}

/**
 * 汇总一次 Executor 运行内的全部失败，供错误详情和后续手动重试复用。
 */
export function formatExecutorAttemptErrors(
  attemptErrors: string[],
  finalError: unknown,
): string {
  const finalMessage = getErrorMessage(finalError);
  const errors =
    attemptErrors.at(-1) === finalMessage
      ? attemptErrors
      : [...attemptErrors, finalMessage];
  return errors
    .map((message, index) => `Attempt ${index + 1}: ${message}`)
    .join("\n");
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
  if (error && typeof error === "object" && "error" in error) {
    return getErrorMessage((error as { error: unknown }).error);
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * 判断工具异常是否来自节点来源校验，避免把可自动修正的模型引用错误升级为 HITL。
 */
export function isNodeProvenanceValidationFailure(error: unknown): boolean {
  return getErrorMessage(error).includes("Node provenance validation failed:");
}

/** 判断 correction mode 是否只返回了承诺文本而没有成功执行写入工具。 */
export function isRequiredStructuredWriteMissing(error: unknown): boolean {
  return getErrorMessage(error).includes(REQUIRED_STRUCTURED_WRITE_ERROR);
}

/** 仅允许外部 correction 的第一次纯空执行获得一次定向重试。 */
export function shouldRetryEmptyExternalCorrection(
  externalCorrection: boolean,
  attempt: number,
  error: unknown,
): boolean {
  return (
    externalCorrection &&
    attempt === 1 &&
    isRequiredStructuredWriteMissing(error)
  );
}

/** 从当前及历史 provenance 错误中提取未被用户输入支持的精确数值声明。 */
export function extractUnsupportedNumericClaims(error: unknown): string[] {
  const claims = [...getErrorMessage(error).matchAll(
    /unsupported_numeric_claims:([^;\r\n]*?)(?=\s+\|\s+Attempt\s+\d+:|;|$)/g,
  )].flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return [...new Set(claims)];
}

/**
 * 将 Document 补证中的精确数值来源缺口提升为定点 HITL。
 *
 * 候选图谱值仅展示在表单说明中；用户必须在答案中重新写出并明确确认，
 * 从而避免 QuestionForm 标签本身被错误计入 user_input provenance。
 */
export function createDocumentEvidenceNumericInputRequired({
  details,
  task,
  agentType,
  displayName,
  knowledgeGraph,
}: {
  details: unknown;
  task: TaskExecutionNode;
  agentType: ExecutorAgentType;
  displayName: string;
  knowledgeGraph: ProductKnowledgeGraph;
}): ExecutorHumanInputRequiredError | null {
  const claims = extractUnsupportedNumericClaims(details);
  if (claims.length === 0) return null;

  const taskText = JSON.stringify(task);
  const normalizedClaims = claims.map(normalizeExactClaim);
  const candidateNodeIds = knowledgeGraph.entities
    .filter((node) => {
      if (node.status === "deprecated" || !taskText.includes(node.id)) {
        return false;
      }
      const nodeText = normalizeExactClaim(`${node.name} ${node.description}`);
      return normalizedClaims.some((claim) => nodeText.includes(claim));
    })
    .map((node) => node.id);
  const candidateSummary = candidateNodeIds.length
    ? `关联候选节点：${candidateNodeIds.join(", ")}；候选值：${claims.join(", ")}。`
    : `待确认候选值：${claims.join(", ")}。`;

  return new ExecutorHumanInputRequiredError({
    taskId: task.task_id,
    agentType,
    displayName,
    category: "hard_conflict",
    title: "性能实测数值尚未得到用户确认",
    details: `${candidateSummary}关联图谱中的候选值不能单独作为本次实测证据。`,
    neededUserInput:
      "请填写 p95、p99、冲突率、锚点漂移率的具体值及监控/日志来源；如采用上方候选基线，请在答案中完整写出四项数值并明确确认采用。",
  });
}

/** 对精确数值及单位做最小归一化，仅用于候选节点 ID 的确定性定位。 */
function normalizeExactClaim(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/**
 * 将结构化写工具的不可接受跳过项提升为一次本地修正。
 */
export function getStructuredWriteError(
  toolName: string,
  toolResult: unknown,
): Error | null {
  if (!STRUCTURED_TOOL_NAMES.has(toolName)) return null;
  if (isNodeProvenanceValidationFailure(toolResult)) {
    return new Error(getErrorMessage(toolResult));
  }
  const result = parseStructuredToolResult(toolResult);
  const failures = result?.skipped?.filter((item) =>
    STRUCTURED_WRITE_FAILURE_PREFIXES.some((prefix) =>
      item.reason.startsWith(prefix),
    ),
  );
  return failures?.length
    ? new Error(
        `Structured graph write validation failed: ${failures
          .map((item) => `${item.id}:${item.reason}`)
          .join(", ")}`,
      )
    : null;
}

/** 判断异常是否为结构化图谱写入校验失败。 */
export function isStructuredWriteValidationFailure(error: unknown): boolean {
  return getErrorMessage(error).includes(
    "Structured graph write validation failed:",
  );
}

/**
 * 构造输出校验失败后的唯一一次原地重试指令。
 *
 * 重试仍提供只读图谱查询工具，要求先核实引用的节点 ID 再写最小结构化条目，
 * 避免在「任务引用 ID 已失效/笔误」时把同一错误写入重复执行。
 */
export function createOutputValidationRetryInstruction({
  hasStructuredItems,
  blockingQuestionCount,
  requiredBlockingCount,
}: {
  hasStructuredItems: boolean;
  blockingQuestionCount: number;
  requiredBlockingCount: number;
}): string {
  return [
    "The previous attempt failed executor output validation. This is the only retry and exposes write tools plus read-only graph queries; verify every referenced node ID with kg_file_query_nodes before writing the minimum items.",
    !hasStructuredItems
      ? "Write the minimum required graph items immediately."
      : "",
    blockingQuestionCount < requiredBlockingCount
      ? `Persist at least ${requiredBlockingCount} new open questions with blocking=true in one kg_file_add_open_questions call; currently ${blockingQuestionCount} are committed.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** 为唯一一次原地修正提供精确的失败原因与核实指引。 */
export function createStructuredWriteRetryInstruction(error: unknown): string {
  return [
    "The previous graph write was partially rejected. This is the only local correction attempt; keep all successful writes and verify each rejected endpoint with kg_file_query_nodes before rewriting.",
    `Validation error: ${getErrorMessage(error)}`,
    "Immediately rewrite only the rejected items using authorized entity and relation types, valid typed directions, and the exact persisted endpoint IDs found via kg_file_query_nodes. Do not merely describe the correction.",
  ].join(" ");
}

/** 兼容工具运行时返回对象或 JSON 字符串。 */
function parseStructuredToolResult(
  value: unknown,
): { skipped?: Array<{ id: string; reason: string }> } | null {
  const parsed = typeof value === "string" ? parseJsonObject(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const skipped = (parsed as { skipped?: unknown }).skipped;
  if (!Array.isArray(skipped)) return {};
  return {
    skipped: skipped.filter(
      (item): item is { id: string; reason: string } =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as { id?: unknown }).id === "string" &&
            typeof (item as { reason?: unknown }).reason === "string",
        ),
    ),
  };
}

/**
 * 用本轮真实搜索来源构造唯一一次本地修正指令。
 */
export function createNodeProvenanceRetryInstruction(
  error: unknown,
  registry: ReturnType<typeof createWebSearchEvidenceRegistry>,
  validUserInputIndexes: number[] = [],
): string {
  const verifiedSources = [...registry.sources.values()].sort(
    (left, right) =>
      Number(left.sourceId) - Number(right.sourceId) ||
      left.sourceId.localeCompare(right.sourceId),
  );
  return [
    "The previous graph write failed node provenance validation. This is the only local correction attempt; do not repeat web research.",
    `Validation error: ${getErrorMessage(error)}`,
    `Valid user_input indexes from this payload: ${JSON.stringify(validUserInputIndexes)}. These are payload indexes, not question ordinals or blocker indexes. If the rejected fact came from a submitted form answer, keep the Evidence and rewrite its provenance with the exact matching index from this list.`,
    `Verified web sources from this run: ${JSON.stringify(verifiedSources)}`,
    "For web-backed Evidence, rewrite provenance with an exact sourceId, title, and URL from this list. If neither submitted user input nor a listed source supports a claim, omit that Evidence and record the uncertainty as a Risk or unverified assumption.",
    "For unsupported_infrastructure_scope, omit the rejected infrastructure detail and record it as a Risk or open question unless the exact scope appears in user input.",
  ].join(" ");
}

/**
 * 保留用户主动停止的 AbortError 语义，避免被包装为 HITL。
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
    ...knowledgeGraph,
    entities: knowledgeGraph.entities.map((entity) => ({
      ...entity,
      provenance: entity.provenance?.map((source) => ({ ...source })),
    })),
    relations: [...knowledgeGraph.relations],
    decisions: [...knowledgeGraph.decisions],
    risks: [...knowledgeGraph.risks],
    open_questions: [...knowledgeGraph.open_questions],
    resolved_open_question_ids: [
      ...(knowledgeGraph.resolved_open_question_ids ?? []),
    ],
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
    entities: current.entities.filter((entity, index) => {
      const original = base.entities[index];
      return !original || !areEntitySnapshotsEqual(original, entity);
    }),
    relations: current.relations.slice(base.relations.length),
    decisions: current.decisions.slice(base.decisions.length),
    risks: current.risks.slice(base.risks.length),
    open_questions: current.open_questions.slice(base.open_questions.length),
    summary: current.summary.slice(base.summary.length),
  };
}

/**
 * 比较节点快照，确保受控废弃状态会作为 Executor 增量传播。
 */
function areEntitySnapshotsEqual(
  left: ProductKnowledgeGraph["entities"][number],
  right: ProductKnowledgeGraph["entities"][number],
): boolean {
  return (
    left.id === right.id &&
    left.status === right.status &&
    left.deprecated_by_task_id === right.deprecated_by_task_id &&
    left.deprecation_reason === right.deprecation_reason &&
    left.replacement_node_id === right.replacement_node_id
  );
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
 * 校验 Executor 是否提交了可供下游 DAG 消费的最小结构化结果。
 */
export function getExecutorOutputValidationError({
  hasStructuredItems,
  blockingQuestionCount,
  requiredBlockingCount,
}: {
  hasStructuredItems: boolean;
  blockingQuestionCount: number;
  requiredBlockingCount: number;
}): string | null {
  if (!hasStructuredItems) {
    return "no structured graph items were committed";
  }
  if (blockingQuestionCount < requiredBlockingCount) {
    return `required ${requiredBlockingCount} blocking open questions, committed ${blockingQuestionCount}`;
  }
  return null;
}

/**
 * 保护运行时分派边界，避免 Planner 输出未知 Agent 类型时静默进入错误节点。
 */
function assertExecutorAgentType(agentType: string): ExecutorAgentType {
  if (isExecutorAgentType(agentType)) return agentType;
  throw new Error(`Unknown executor agent type: ${agentType}`);
}
