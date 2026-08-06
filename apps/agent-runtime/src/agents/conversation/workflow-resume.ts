/**
 * Workflow 恢复上下文解析器
 *
 * 从历史聊天消息中提取 Request Agent 分析、Planner DAG、Executor 结果和用户刚提交的
 * HITL 表单答案，用于在硬阻塞、补充信息确认或用户手动继续后复用已有上下文。
 *
 * Responsibilities:
 * - 解析历史 tagged block 中的结构化 workflow 产物
 * - 根据表单 ID 推断需要重跑的 Executor 任务
 * - 生成 streamWorkflowGraph 可直接消费的恢复上下文
 *
 * Notes:
 * - 本模块只恢复调度上下文，不直接调用 Agent 或数据库。
 */

import {
  ExecutorAgentResultSchema,
  ProductWorkflowResultSchema,
  RequestAnalysisSchema,
  TaskExecutionPlanSchema,
  type ChatMessage,
  type ExecutorAgentResult,
  type ProductKnowledgeGraph,
  type ProductWorkflowResult,
} from "@repo/shared";
import { getFormAnswerId } from "../../utils/form-parser";
import type { WorkflowAnswerResolution } from "../../types";
import type { WorkflowResumeContext } from "../product-workflow/types";
import { parseUserInputBlock } from "../request/user-input";
import {
  isExecutorAgentType,
  type ExecutorAgentType,
} from "../product-workflow/executor-agent/definitions";

const EXECUTOR_BLOCKER_FORM_PREFIX = "executor-blocker-";
const PRODUCT_WORKFLOW_CONFIRMATION_FORM_ID = "product-workflow-confirmation";

/**
 * 基于历史消息和最新知识图谱构建 workflow 恢复上下文。
 */
export function createWorkflowResumeContextFromMessages({
  messages,
  knowledgeGraph,
  workflowAnswerResolution,
}: {
  messages: ChatMessage[];
  knowledgeGraph?: ProductKnowledgeGraph | null;
  workflowAnswerResolution?: WorkflowAnswerResolution | null;
}): WorkflowResumeContext | null {
  const formId = parseLatestFormAnswerId(messages);
  if (!formId) return null;

  return createWorkflowResumeContext({
    formId,
    knowledgeGraph,
    messages,
    workflowAnswerResolution,
  });
}

/**
 * 基于 Conversation Agent 明确识别出的继续意图，从历史消息恢复最近的工作流上下文。
 */
export function createWorkflowContinuationResumeContextFromMessages({
  messages,
  knowledgeGraph,
}: {
  messages: ChatMessage[];
  knowledgeGraph?: ProductKnowledgeGraph | null;
}): WorkflowResumeContext | null {
  return createWorkflowResumeContext({
    formId: null,
    knowledgeGraph,
    messages,
  });
}

/**
 * 为 Executor 错误卡片的定点重试恢复最近 DAG，不重新解释上一条表单答案。
 */
export function createWorkflowExecutorRetryResumeContextFromMessages({
  messages,
  knowledgeGraph,
  taskId,
}: {
  messages: ChatMessage[];
  knowledgeGraph?: ProductKnowledgeGraph | null;
  taskId: string;
}): WorkflowResumeContext | null {
  const context = createWorkflowResumeContext({
    formId: null,
    knowledgeGraph,
    messages,
  });
  const task = context?.plan?.tasks.find((item) => item.task_id === taskId);
  const alreadyCompleted = context?.executorResults?.some(
    (result) => result.task_id === taskId,
  );
  if (!context?.requestAnalysis || !task || alreadyCompleted) return null;
  const userInputBody = findLatestTaggedText(
    messages,
    "<user-input",
    "</user-input>",
  );

  return {
    ...context,
    userInputBlock: userInputBody
      ? `<user-input>\n${userInputBody}\n</user-input>`
      : undefined,
    rerunTaskIds: [taskId],
    forceSupplementPlan: false,
  };
}

/**
 * 统一构造表单恢复和继续恢复上下文，避免两条路径遗漏 Planner/Executor 历史产物。
 */
function createWorkflowResumeContext({
  formId,
  messages,
  knowledgeGraph,
  workflowAnswerResolution,
}: {
  formId: string | null;
  messages: ChatMessage[];
  knowledgeGraph?: ProductKnowledgeGraph | null;
  workflowAnswerResolution?: WorkflowAnswerResolution | null;
}): WorkflowResumeContext | null {
  const requestAnalysis =
    findLatestTaggedPayload(
      messages,
      "<request-analysis",
      "</request-analysis>",
      RequestAnalysisSchema,
    ) ??
    findLatestStructuredPayload(
      messages,
      "requestAnalysis",
      RequestAnalysisSchema,
    );
  const productWorkflow =
    findLatestTaggedPayload(
      messages,
      "<product-workflow",
      "</product-workflow>",
      ProductWorkflowResultSchema,
    ) ?? workflowAnswerResolution?.workflow ?? null;
  const plan =
    findLatestTaggedPayload(
      messages,
      "<task-execution",
      "</task-execution>",
      TaskExecutionPlanSchema,
    ) ??
    productWorkflow?.planner ??
    null;
  const executorResults = collectExecutorResults(messages, productWorkflow);
  const originalUserInput = findOriginalUserInput(messages);

  if (!requestAnalysis) {
    return knowledgeGraph ? { knowledgeGraph, rerunTaskIds: [] } : null;
  }

  // 允许“继续之前中断的对话”在只有 Request Analysis、还没有 DAG 的情况下从 Planner 继续。
  if (!plan) {
    return {
      requestAnalysis,
      originalUserInput,
      executorResults,
      knowledgeGraph: knowledgeGraph ?? null,
      rerunTaskIds: [],
      forceSupplementPlan: false,
    };
  }

  const continuationExecutorResults =
    !formId && plan.status === "supplement"
      ? removeExecutorResultsForPlanTasks(executorResults, plan)
      : executorResults;
  const rerunTaskIds = formId
    ? inferRerunTaskIds(formId, executorResults, productWorkflow)
    : inferContinuationRerunTaskIds(plan, productWorkflow);
  const forceSupplementPlan = formId
    ? isPlannerConfirmationFormId(formId, productWorkflow)
    : false;
  const answeredOpenQuestionIds = formId
    ? inferAnsweredOpenQuestionIds({
        formId,
        productWorkflow,
        executorResults: continuationExecutorResults,
        knowledgeGraph,
        workflowAnswerResolution,
      })
    : [];
  const resolvedExecutorResults = formId
    ? resolveAnsweredOpenQuestions(
        continuationExecutorResults,
        answeredOpenQuestionIds,
      )
    : continuationExecutorResults;
  const resolvedKnowledgeGraph = formId
    ? resolveAnsweredGraphOpenQuestions(
        knowledgeGraph,
        answeredOpenQuestionIds,
        workflowAnswerResolution,
      )
    : knowledgeGraph;
  const supplementSourceTaskIds = forceSupplementPlan ? rerunTaskIds : [];
  const supplementAffectedTaskIds = forceSupplementPlan
    ? inferSupplementAffectedTaskIds(
        supplementSourceTaskIds,
        plan,
        resolvedKnowledgeGraph,
      )
    : [];

  return {
    requestAnalysis,
    originalUserInput,
    plan,
    executorResults: resolvedExecutorResults,
    knowledgeGraph: resolvedKnowledgeGraph ?? null,
    rerunTaskIds,
    forceSupplementPlan,
    answeredOpenQuestionIds,
    productWorkflow,
    supplementSourceTaskIds,
    supplementAffectedTaskIds,
    supplementAgentTypes: forceSupplementPlan
      ? inferSupplementAgentTypes(supplementAffectedTaskIds, plan)
      : [],
  };
}

/**
 * 恢复当前工作流最初的结构化用户输入，供自动审查修正保留稳定输入索引。
 */
function findOriginalUserInput(
  messages: ChatMessage[],
): ReturnType<typeof parseUserInputBlock> {
  const body = findLatestTaggedText(
    messages,
    "<user-input",
    "</user-input>",
  );
  if (!body) return [];

  try {
    return parseUserInputBlock(body);
  } catch {
    return [];
  }
}

/**
 * 用户已经回答表单后，旧 Executor 结果中的同源问题不再参与后续 Critique 聚合。
 */
function resolveAnsweredOpenQuestions(
  executorResults: ExecutorAgentResult[],
  answeredOpenQuestionIds: string[],
): ExecutorAgentResult[] {
  const answeredIds = new Set(answeredOpenQuestionIds);
  return executorResults.map((result) => ({
    ...result,
    open_questions: result.open_questions.filter(
      (question) => !answeredIds.has(question.id),
    ),
  }));
}

/**
 * 从本轮运行态移除已经由表单回答的同源问题，避免 Executor 再次把旧问题当成未决输入。
 * 同时保留精确 ID tombstone，供 API 归档和后续恢复过滤。
 */
export function resolveAnsweredGraphOpenQuestions(
  knowledgeGraph: ProductKnowledgeGraph | null | undefined,
  answeredOpenQuestionIds: string[],
  workflowAnswerResolution?: WorkflowAnswerResolution | null,
): ProductKnowledgeGraph | null {
  if (!knowledgeGraph) return null;
  const answeredIds = new Set(answeredOpenQuestionIds);
  const resolvedOpenQuestionIds = [
    ...new Set([
      ...(knowledgeGraph.resolved_open_question_ids ?? []),
      ...answeredOpenQuestionIds,
    ]),
  ];
  const sourceAgentByQuestionId = new Map(
    (workflowAnswerResolution?.questions ?? []).flatMap((question) =>
      question.sources.flatMap((source) =>
        source.open_question_id && isExecutorAgentType(source.source_agent)
          ? [[source.open_question_id, source.source_agent] as const]
          : [],
      ),
    ),
  );
  return {
    ...knowledgeGraph,
    resolved_open_question_ids: resolvedOpenQuestionIds,
    open_questions: knowledgeGraph.open_questions
      .filter((question) => !answeredIds.has(question.id))
      .map((question) => ({
        ...question,
        source_agent:
          question.source_agent ?? sourceAgentByQuestionId.get(question.id),
      })),
  };
}

/**
 * Critique Question Form 的来源携带精确问题 ID；其他表单不得推断并批量关闭问题。
 */
function inferAnsweredOpenQuestionIds({
  formId,
  productWorkflow,
  executorResults,
  knowledgeGraph,
  workflowAnswerResolution,
}: {
  formId: string;
  productWorkflow: ProductWorkflowResult | null;
  executorResults: ExecutorAgentResult[];
  knowledgeGraph?: ProductKnowledgeGraph | null;
  workflowAnswerResolution?: WorkflowAnswerResolution | null;
}): string[] {
  if (!isPlannerConfirmationFormId(formId, productWorkflow)) return [];
  const matchingResolution =
    workflowAnswerResolution?.formId === formId
      ? workflowAnswerResolution
      : null;
  const answeredIds = new Set<string>(
    matchingResolution
      ? matchingResolution.questions.flatMap((question) =>
          question.answered
            ? question.sources.flatMap((source) =>
                source.open_question_id ? [source.open_question_id] : [],
              )
            : [],
        )
      : (productWorkflow?.proposal_questions ?? []).flatMap((question) =>
          question.sources.flatMap((source) =>
            source.open_question_id ? [source.open_question_id] : [],
          ),
        ),
  );

  if (!matchingResolution) return [...answeredIds];

  const candidates = [
    ...executorResults.flatMap((result) =>
      result.open_questions.map((question) => ({
        id: question.id,
        text: question.text,
        sourceTaskId: result.task_id,
      })),
    ),
    ...(knowledgeGraph?.open_questions ?? []).map((question) => ({
      id: question.id,
      text: question.text,
      sourceTaskId: question.source_task_id,
    })),
  ];

  for (const question of matchingResolution.questions.filter(
    (item) => item.answered,
  )) {
    for (const source of question.sources.filter(
      (item) => !item.open_question_id,
    )) {
      const candidateIds = new Set(
        candidates
          .filter(
            (candidate) =>
              candidate.sourceTaskId === source.source_task_id &&
              normalizeQuestionText(candidate.text) ===
                normalizeQuestionText(question.label),
          )
          .map((candidate) => candidate.id),
      );
      if (candidateIds.size === 1) {
        answeredIds.add([...candidateIds][0]!);
      }
    }
  }

  return [...answeredIds];
}

/**
 * 旧表单缺少问题 ID 时，仅在同一来源任务内做稳定文本匹配。
 */
function normalizeQuestionText(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .replace(/[?？。.!！]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * 提取最新用户表单答案中的 form id。
 */
function parseLatestFormAnswerId(messages: ChatMessage[]): string | null {
  const latestUserMessage = messages
    .filter((message) => message.role === "user")
    .at(-1);
  return latestUserMessage ? getFormAnswerId(latestUserMessage.content) : null;
}

/**
 * 根据表单来源推断直接受影响的任务。
 */
function inferRerunTaskIds(
  formId: string,
  executorResults: ExecutorAgentResult[],
  productWorkflow: ProductWorkflowResult | null,
): string[] {
  if (formId.startsWith(EXECUTOR_BLOCKER_FORM_PREFIX)) {
    return [formId.slice(EXECUTOR_BLOCKER_FORM_PREFIX.length)].filter(Boolean);
  }

  if (formId.endsWith("-proposal-decision")) {
    return mergeTaskIds([
      ...inferProductWorkflowRerunTaskIds(productWorkflow),
      ...inferOpenQuestionTaskIds(executorResults),
    ]);
  }

  if (isPlannerConfirmationFormId(formId, productWorkflow)) {
    return mergeTaskIds([
      ...inferProductWorkflowRerunTaskIds(productWorkflow),
      ...inferOpenQuestionTaskIds(executorResults),
    ]);
  }

  return [];
}

/**
 * 继续恢复时优先执行已经生成但未运行的 supplement DAG，否则沿用 Review 指定的修正任务。
 */
function inferContinuationRerunTaskIds(
  plan: NonNullable<WorkflowResumeContext["plan"]>,
  productWorkflow: ProductWorkflowResult | null,
): string[] {
  if (plan.status === "supplement") {
    return plan.tasks.map((task) => task.task_id);
  }

  return inferProductWorkflowRerunTaskIds(productWorkflow);
}

/**
 * 从 Critique Agent 的结构化结论中提取需要重跑或补充的任务。
 */
function inferProductWorkflowRerunTaskIds(
  productWorkflow: ProductWorkflowResult | null,
): string[] {
  if (!productWorkflow) return [];

  return mergeTaskIds([
    ...(productWorkflow.review.retry_task_ids ?? []),
    ...productWorkflow.proposal_questions.flatMap((question) => [
      ...(question.source_task_id ? [question.source_task_id] : []),
      ...question.sources.map((source) => source.source_task_id),
    ]),
  ]);
}

/**
 * supplement DAG 已经重新生成时，旧 DAG 的同名 Executor 结果不能让新 DAG 被误判为完成。
 */
function removeExecutorResultsForPlanTasks(
  executorResults: ExecutorAgentResult[],
  plan: NonNullable<WorkflowResumeContext["plan"]>,
): ExecutorAgentResult[] {
  const planTaskIds = new Set(plan.tasks.map((task) => task.task_id));
  return executorResults.filter((result) => !planTaskIds.has(result.task_id));
}

/**
 * 按出现顺序合并任务 ID，并过滤空值。
 */
function mergeTaskIds(taskIds: string[]): string[] {
  return [...new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))];
}

/**
 * Planner 汇总后的问题表单答案需要重新进入 Planner，生成补充 DAG。
 */
function isPlannerConfirmationFormId(
  formId: string,
  productWorkflow: ProductWorkflowResult | null,
): boolean {
  return (
    formId === PRODUCT_WORKFLOW_CONFIRMATION_FORM_ID ||
    formId.endsWith("-proposal-decision") ||
    productWorkflow?.confirmation_id === formId
  );
}

/**
 * 将 Critique 问题来源任务映射回受影响的 Executor，供 supplement Planner 限定范围。
 */
function inferSupplementAgentTypes(
  taskIds: string[],
  plan: NonNullable<WorkflowResumeContext["plan"]>,
): ExecutorAgentType[] {
  const taskIdSet = new Set(taskIds);
  return [
    ...new Set(
      plan.tasks
        .filter((task) => taskIdSet.has(task.task_id))
        .map((task) => task.assigned_agent)
        .filter(isExecutorAgentType),
    ),
  ];
}

/**
 * 从问题来源任务沿活跃图关系扩展一跳，找出需要参与补充修正的原 DAG 任务。
 */
export function inferSupplementAffectedTaskIds(
  sourceTaskIds: string[],
  plan: NonNullable<WorkflowResumeContext["plan"]>,
  knowledgeGraph: ProductKnowledgeGraph | null | undefined,
): string[] {
  const affectedTaskIds = new Set(sourceTaskIds);
  if (!knowledgeGraph) {
    return plan.tasks
      .map((task) => task.task_id)
      .filter((taskId) => affectedTaskIds.has(taskId));
  }

  const activeEntities = knowledgeGraph.entities.filter(
    (entity) => entity.status !== "deprecated",
  );
  const activeEntityById = new Map(
    activeEntities.map((entity) => [entity.id, entity]),
  );
  const sourceEntityIds = new Set(
    activeEntities
      .filter(
        (entity) =>
          entity.source_task_id &&
          affectedTaskIds.has(entity.source_task_id),
      )
      .map((entity) => entity.id),
  );

  for (const relation of knowledgeGraph.relations) {
    const source = activeEntityById.get(relation.source);
    const target = activeEntityById.get(relation.target);
    if (!source || !target) continue;
    if (
      !sourceEntityIds.has(source.id) &&
      !sourceEntityIds.has(target.id)
    ) {
      continue;
    }
    if (source.source_task_id) affectedTaskIds.add(source.source_task_id);
    if (target.source_task_id) affectedTaskIds.add(target.source_task_id);
    if (relation.source_task_id) {
      affectedTaskIds.add(relation.source_task_id);
    }
  }

  return plan.tasks
    .map((task) => task.task_id)
    .filter((taskId) => affectedTaskIds.has(taskId));
}

/**
 * 根据 Executor 尚未关闭的 open questions 定位需要基于用户补充信息重跑的任务。
 */
function inferOpenQuestionTaskIds(
  executorResults: ExecutorAgentResult[],
): string[] {
  return [
    ...new Set(
      executorResults
        .filter((result) =>
          result.open_questions.some((question) => question.blocking),
        )
        .map((result) => result.task_id),
    ),
  ];
}

/**
 * 收集历史中的 Executor 结果，并用 task_id 保持幂等。
 */
function collectExecutorResults(
  messages: ChatMessage[],
  productWorkflow: unknown,
): ExecutorAgentResult[] {
  const results = new Map<string, ExecutorAgentResult>();
  const workflowResult = ProductWorkflowResultSchema.safeParse(productWorkflow);
  if (workflowResult.success) {
    for (const result of workflowResult.data.executor_results) {
      results.set(result.task_id, result);
    }
  }

  for (const message of messages) {
    const blocks = extractTaggedBlocks(
      message.content,
      "<executor-result",
      "</executor-result>",
    );
    for (const block of blocks) {
      const parsed = parseJsonBlock(block);
      const result = ExecutorAgentResultSchema.safeParse(parsed);
      if (result.success) {
        results.set(result.data.task_id, result.data);
      }
    }
  }

  return [...results.values()];
}

/**
 * 读取最新匹配的 tagged block 并按 schema 校验。
 */
function findLatestTaggedPayload<T>(
  messages: ChatMessage[],
  startMarker: string,
  endMarker: string,
  schema: {
    safeParse: (value: unknown) => { success: true; data: T } | { success: false };
  },
): T | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const block = extractTaggedBlocks(
      messages[index]?.content ?? "",
      startMarker,
      endMarker,
    ).at(-1);
    if (!block) continue;

    const parsed = schema.safeParse(parseJsonBlock(block));
    if (parsed.success) return parsed.data;
  }

  return null;
}

/**
 * 读取最新 tagged block 正文，供恢复原始用户输入。
 */
function findLatestTaggedText(
  messages: ChatMessage[],
  startMarker: string,
  endMarker: string,
): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const block = extractTaggedBlocks(
      messages[index]?.content ?? "",
      startMarker,
      endMarker,
    ).at(-1);
    if (block) return block;
  }

  return null;
}

/**
 * 从消息对象上的结构化字段恢复 payload，兼容正文未包含 tagged block 的历史消息。
 */
function findLatestStructuredPayload<T>(
  messages: ChatMessage[],
  key: string,
  schema: {
    safeParse: (value: unknown) => { success: true; data: T } | { success: false };
  },
): T | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as ChatMessage & Record<string, unknown>;
    const value = message[key];
    if (!value) continue;

    const payload =
      typeof value === "object" && value !== null && "content" in value
        ? (value as { content?: unknown }).content
        : value;
    const parsedPayload = normalizeStructuredPayloadString(payload, key);
    const parsed = schema.safeParse(parsedPayload);
    if (parsed.success) return parsed.data;
  }

  return null;
}

/**
 * 将持久化字段中的字符串恢复为 JSON 对象，必要时兼容被包裹的 tagged block。
 */
function normalizeStructuredPayloadString(
  payload: unknown,
  key: string,
): unknown {
  if (typeof payload !== "string") return payload;

  const parsed = parseJsonBlock(payload);
  if (parsed) return parsed;

  if (key === "requestAnalysis") {
    return parseJsonBlock(
      extractTaggedBlocks(
        payload,
        "<request-analysis",
        "</request-analysis>",
      ).at(-1) ?? "",
    );
  }

  return null;
}

/**
 * 提取文本内所有指定 tagged block 的正文。
 */
function extractTaggedBlocks(
  text: string,
  startMarker: string,
  endMarker: string,
): string[] {
  const blocks: string[] = [];
  const startPattern = new RegExp(escapeRegExp(startMarker), "gi");
  let match: RegExpExecArray | null;

  while ((match = startPattern.exec(text))) {
    const openEnd = text.indexOf(">", match.index);
    if (openEnd === -1) break;
    const closeIndex = text.indexOf(endMarker, openEnd + 1);
    if (closeIndex === -1) break;

    blocks.push(text.slice(openEnd + 1, closeIndex).trim());
    startPattern.lastIndex = closeIndex + endMarker.length;
  }

  return blocks;
}

/**
 * 安全解析 tagged block 中的 JSON。
 */
function parseJsonBlock(block: string): unknown {
  try {
    return JSON.parse(block);
  } catch {
    return null;
  }
}

/**
 * 转义正则字面量。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
