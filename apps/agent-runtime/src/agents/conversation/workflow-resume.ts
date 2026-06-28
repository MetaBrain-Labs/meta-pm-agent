/**
 * Workflow 恢复上下文解析器
 *
 * 从历史聊天消息中提取 Request Agent 分析、Planner DAG、Executor 结果和用户刚提交的
 * HITL 表单答案，用于在硬阻塞或补充信息确认后从已有上下文继续运行产品工作流。
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
  type ProductKnowledgeGraph,
} from "@repo/shared";
import type { WorkflowResumeContext } from "../product-workflow/types";

const EXECUTOR_BLOCKER_FORM_PREFIX = "executor-blocker-";

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

  const requestAnalysis = findLatestTaggedPayload(
    messages,
    "<request-analysis",
    "</request-analysis>",
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

  if (!requestAnalysis || !plan) {
    return knowledgeGraph ? { knowledgeGraph, rerunTaskIds: [] } : null;
  }

  return {
    requestAnalysis,
    plan,
    executorResults,
    knowledgeGraph: knowledgeGraph ?? null,
    rerunTaskIds: inferRerunTaskIds(formId, executorResults),
  };
}

/**
 * 提取最新用户表单答案中的 form id。
 */
function parseLatestFormAnswerId(messages: ChatMessage[]): string | null {
  const latestUserMessage = messages
    .filter((message) => message.role === "user")
    .at(-1);
  const firstLine = latestUserMessage?.content.split("\n")[0]?.trim() ?? "";
  const match = /^\[form answers\s*-\s*([^\]]+)\]/i.exec(firstLine);
  return match?.[1]?.trim() || null;
}

/**
 * 根据表单来源推断直接受影响的任务。
 */
function inferRerunTaskIds(
  formId: string,
  executorResults: ReturnType<typeof collectExecutorResults>,
): string[] {
  if (formId.startsWith(EXECUTOR_BLOCKER_FORM_PREFIX)) {
    return [formId.slice(EXECUTOR_BLOCKER_FORM_PREFIX.length)].filter(Boolean);
  }

  if (formId.endsWith("-proposal-decision")) {
    return [
      ...new Set(
        executorResults
          .filter((result) => result.open_questions.length > 0)
          .map((result) => result.task_id),
      ),
    ];
  }

  return [];
}

/**
 * 收集历史中的 Executor 结果，并用 task_id 保持幂等。
 */
function collectExecutorResults(
  messages: ChatMessage[],
  productWorkflow: unknown,
) {
  const results = new Map<string, ReturnType<typeof ExecutorAgentResultSchema.parse>>();
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
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
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
