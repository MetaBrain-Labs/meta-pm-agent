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
import type { WorkflowResumeContext } from "../product-workflow/types";
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
}: {
  messages: ChatMessage[];
  knowledgeGraph?: ProductKnowledgeGraph | null;
}): WorkflowResumeContext | null {
  const formId = parseLatestFormAnswerId(messages);
  if (!formId) return null;

  return createWorkflowResumeContext({
    formId,
    knowledgeGraph,
    messages,
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
 * 统一构造表单恢复和继续恢复上下文，避免两条路径遗漏 Planner/Executor 历史产物。
 */
function createWorkflowResumeContext({
  formId,
  messages,
  knowledgeGraph,
}: {
  formId: string | null;
  messages: ChatMessage[];
  knowledgeGraph?: ProductKnowledgeGraph | null;
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
  const productWorkflow = findLatestTaggedPayload(
    messages,
    "<product-workflow",
    "</product-workflow>",
    ProductWorkflowResultSchema,
  );
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

  if (!requestAnalysis) {
    return knowledgeGraph ? { knowledgeGraph, rerunTaskIds: [] } : null;
  }

  // 允许“继续之前中断的对话”在只有 Request Analysis、还没有 DAG 的情况下从 Planner 继续。
  if (!plan) {
    return {
      requestAnalysis,
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

  return {
    requestAnalysis,
    plan,
    executorResults: continuationExecutorResults,
    knowledgeGraph: knowledgeGraph ?? null,
    rerunTaskIds,
    forceSupplementPlan,
    supplementAgentTypes: forceSupplementPlan
      ? inferSupplementAgentTypes(rerunTaskIds, plan)
      : [],
  };
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
 * 根据 Executor 尚未关闭的 open questions 定位需要基于用户补充信息重跑的任务。
 */
function inferOpenQuestionTaskIds(
  executorResults: ExecutorAgentResult[],
): string[] {
  return [
    ...new Set(
      executorResults
        .filter((result) => result.open_questions.length > 0)
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
