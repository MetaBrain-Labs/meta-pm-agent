/**
 * 消息持久化仓库
 *
 * 负责 message 表的读写，并在读取历史消息时恢复推理内容、结构化业务产物、
 * 工具调用和 token 用量等前端展示所需的数据。
 *
 * Responsibilities:
 * - 持久化用户消息和各 Agent assistant 消息
 * - 将数据库行映射为前端 DTO
 * - 将 token_usage 记录关联回对应的 assistant message
 *
 * Notes:
 * - 本仓库只处理消息和展示恢复，不负责 Agent 运行编排。
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import {
  ProductWorkflowResultSchema,
  TaskExecutionPlanSchema,
  type ChatMessage,
  type ExecutorAgentResult,
  type ProductWorkflowResult,
  type RequestAnalysis,
  type TaskExecutionPlan,
  type WorkflowRetryAction,
} from "@repo/shared";
import {
  parseUserInputPayload,
  type UserInputRecord,
} from "../utils/user-input";
import { parseRequestAnalysisPayload } from "../utils/request-analysis";
import { parseTaskExecutionPlanPayload } from "../utils/task-execution";
import {
  createProductWorkflowDisplaySnapshot,
  parseExecutorResultPayload,
  parseProductWorkflowPayload,
} from "../utils/product-workflow";
import {
  listTokenUsageByConversation,
  type TokenUsageDto,
} from "./token-usage-repository";

/**
 * 数据库 message 表原始行结构。
 */
export interface MessageRow {
  id: string;
  role: string;
  type: string | null;
  content: string;
  meta: unknown;
  user_input: unknown;
  created_at: Date | null;
}

/**
 * 消息的数据传输对象，包含 Agent 类型、推理内容和结构化分析结果。
 */
export interface MessageDto {
  id: string;
  role: "user" | "assistant";
  type?: string | null;
  content: string;
  timestamp: string;
  reasoningContent?: string;
  toolCalls?: ToolCallDto[];
  subagentTraces?: SubagentTraceDto[];
  agentError?: AgentErrorDto;
  userInput?: UserInputRecord[] | null;
  requestAnalysis?: RequestAnalysis | null;
  taskExecutionPlan?: TaskExecutionPlan | null;
  executorResult?: ExecutorAgentResult | null;
  executorResults?: ExecutorAgentResult[];
  productWorkflow?: ProductWorkflowResult | null;
  tokenUsages?: TokenUsageDto[];
}

/**
 * 前端展示工具调用卡片所需的最小结构。
 */
export interface ToolCallDto {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
  agentType?: string;
  status?: "running" | "complete";
}

/**
 * Orchestrator 内嵌 SubAgent 展示所需的最小执行轨迹。
 */
export interface SubagentTraceDto {
  id?: string;
  parentAgentType?: string;
  subagentType: string;
  description?: string;
  thinking?: string;
  result?: unknown;
  status: "running" | "complete";
}

/**
 * 持久化错误卡片及其可选定点重试动作。
 */
export interface AgentErrorDto {
  agentType?: string;
  message: string;
  retryAction?: WorkflowRetryAction;
}

interface ExecutorRetryErrorRow {
  error_message: string | null;
}

interface ArchivedProductWorkflowRow {
  workflow: unknown;
}

/**
 * 读取指定任务最近一次由服务端持久化的可重试错误。
 */
export async function findLatestExecutorRetryError(
  conversationId: string,
  taskId: string,
): Promise<string | null> {
  const rows = await prisma.$queryRaw<ExecutorRetryErrorRow[]>`
    SELECT "meta"->'agentError'->>'message' AS "error_message"
    FROM "message"
    WHERE "conversation_id" = ${conversationId}
      AND "meta"->'agentError'->'retryAction'->>'taskId' = ${taskId}
    ORDER BY "created_at" DESC, "id" DESC
    LIMIT 1
  `;
  return rows[0]?.error_message ?? null;
}

/**
 * 查询指定会话的所有历史消息，按用户消息、Conversation Agent、Request Agent 的顺序恢复。
 */
export async function listConversationMessages(
  conversationId: string,
): Promise<MessageDto[]> {
  const rows = await prisma.$queryRaw<MessageRow[]>`
    SELECT
      "id",
      "role",
      "type",
      "content",
      "meta",
      "user_input",
      "created_at"
    FROM "message"
    WHERE "conversation_id" = ${conversationId}
    ORDER BY
      "created_at" ASC,
      CASE
        WHEN "role" = 'user' THEN 0
        WHEN "type" = 'conversation' THEN 1
        WHEN "type" = 'request' THEN 2
        WHEN "type" = 'planner' THEN 3
        WHEN "type" = 'executor-product-strategy' THEN 4
        WHEN "type" = 'executor-market-research' THEN 5
        WHEN "type" = 'executor-gtm' THEN 6
        WHEN "type" = 'executor-product-discovery' THEN 7
        WHEN "type" = 'executor-product-execution' THEN 8
        WHEN "type" = 'executor-marketing-growth' THEN 9
        WHEN "type" = 'executor-data-analytics' THEN 10
        WHEN "type" = 'executor-ai-shipping' THEN 11
        WHEN "type" = 'executor-toolkit' THEN 12
        WHEN "type" = 'executor-interface-craft' THEN 13
        WHEN "type" = 'product_director' THEN 14
        WHEN "type" = 'conversation_confirmation' THEN 15
        ELSE 16
      END,
      "id" ASC
  `;

  const archivedWorkflows =
    await listArchivedProductWorkflowDisplays(conversationId);
  const restoredMessages = attachArchivedProductWorkflowDisplays(
    rows.map(mapMessageRow),
    archivedWorkflows,
  );
  const messages = attachExecutorResultsToPlannerMessages(restoredMessages);
  const tokenUsages = await listTokenUsageByConversation(conversationId);

  return attachTokenUsagesToMessages(messages, tokenUsages);
}

/**
 * 批量持久化会话消息，使用 UPSERT 逻辑；这里只写入用户消息。
 */
export async function persistConversationMessages(
  conversationId: string,
  messages: ChatMessage[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const message of messages) {
      const meta = JSON.stringify({
        sessionId: message.sessionId,
        timestamp: message.timestamp,
        ...(message.reasoningContent
          ? { reasoningContent: message.reasoningContent }
          : {}),
      });

      await tx.$executeRaw`
        INSERT INTO "message" (
          "id",
          "conversation_id",
          "role",
          "content",
          "meta",
          "user_input",
          "type"
        )
        VALUES (
          ${message.id},
          ${conversationId},
          ${message.role},
          ${message.content},
          ${meta}::jsonb,
          NULL,
          NULL
        )
        ON CONFLICT ("id") DO UPDATE
        SET
          "content" = EXCLUDED."content",
          "meta" = EXCLUDED."meta",
          "user_input" = EXCLUDED."user_input",
          "type" = EXCLUDED."type"
      `;
    }

    await tx.$executeRaw`
      UPDATE "conversation"
      SET "last_message_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${conversationId}
    `;
  });
}

/**
 * 将数据库行映射为消息 DTO，兼容旧消息中内联的 tagged block。
 */
export function mapMessageRow(row: MessageRow): MessageDto {
  const meta = parseRecord(row.meta);
  const userInput = parseRecord(row.user_input);

  // 旧消息可能只把 tagged block 存在正文里，读取历史消息时需要从正文回填结构化字段。
  const inlineUserInput = parseUserInputPayload(row.content);
  const inlineRequestAnalysis = parseRequestAnalysisPayload(row.content);
  const inlineTaskExecutionPlan = parseTaskExecutionPlanPayload(row.content);
  const inlineExecutorResult = parseExecutorResultPayload(row.content);
  const inlineProductWorkflow = parseProductWorkflowPayload(row.content);
  const persistedTaskExecutionPlan = TaskExecutionPlanSchema.safeParse(
    meta?.taskExecutionPlan,
  );
  const persistedProductWorkflow = ProductWorkflowResultSchema.safeParse(
    meta?.productWorkflow,
  );

  // 正文返回给前端展示时去掉结构化 block，避免 JSON 原文和卡片重复显示。
  const cleanedContent = removeTaggedBlock(
    removeTaggedBlock(
      removeTaggedBlock(
        removeTaggedBlock(
          removeTaggedBlock(row.content, "<user-input", "</user-input>"),
          "<request-analysis",
          "</request-analysis>",
        ),
        "<task-execution",
        "</task-execution>",
      ),
      "<executor-result",
      "</executor-result>",
    ),
    "<product-workflow",
    "</product-workflow>",
  );
  const extractedSearch = extractWebSearchToolCalls(cleanedContent);
  const metaToolCalls = Array.isArray(meta?.toolCalls)
    ? normalizeToolCalls(meta.toolCalls)
    : [];
  const subagentTraces = Array.isArray(meta?.subagentTraces)
    ? normalizeSubagentTraces(meta.subagentTraces)
    : [];
  const agentError = normalizeAgentError(meta?.agentError);
  const timestamp =
    typeof meta?.timestamp === "string"
      ? meta.timestamp
      : (row.created_at ?? new Date()).toISOString();

  return {
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    type: row.type,
    content: extractedSearch.content,
    timestamp,
    ...(typeof meta?.reasoningContent === "string"
      ? { reasoningContent: meta.reasoningContent }
      : {}),
    ...(metaToolCalls.length > 0 || extractedSearch.toolCalls.length > 0
      ? { toolCalls: [...metaToolCalls, ...extractedSearch.toolCalls] }
      : {}),
    ...(subagentTraces.length > 0 ? { subagentTraces } : {}),
    ...(agentError ? { agentError } : {}),
    userInput: Array.isArray(userInput?.user_input)
      ? (userInput.user_input as UserInputRecord[])
      : inlineUserInput,
    requestAnalysis: inlineRequestAnalysis,
    taskExecutionPlan: persistedTaskExecutionPlan.success
      ? persistedTaskExecutionPlan.data
      : inlineTaskExecutionPlan,
    executorResult: inlineExecutorResult,
    productWorkflow: persistedProductWorkflow.success
      ? persistedProductWorkflow.data
      : inlineProductWorkflow,
  };
}

/**
 * 从既有 request_form_item 恢复旧消息被正文摘要替代前的 Critique 展示快照。
 */
async function listArchivedProductWorkflowDisplays(
  conversationId: string,
): Promise<ProductWorkflowResult[]> {
  const rows = await prisma.$queryRaw<ArchivedProductWorkflowRow[]>`
    SELECT "item"."payload"->'workflow' AS "workflow"
    FROM "request_form_item" AS "item"
    INNER JOIN "request_form" AS "form"
      ON "form"."id" = "item"."form_id"
    WHERE "form"."chat_id" = ${conversationId}
      AND "item"."payload"->'workflow' IS NOT NULL
    ORDER BY "item"."created_at" ASC, "item"."id" ASC
  `;
  return rows.flatMap((row) => {
    const parsed = ProductWorkflowResultSchema.safeParse(row.workflow);
    return parsed.success
      ? [createProductWorkflowDisplaySnapshot(parsed.data)]
      : [];
  });
}

/**
 * 将旧版归档摘要按 confirmation_id 还原为 Critique 卡片。
 */
export function attachArchivedProductWorkflowDisplays(
  messages: MessageDto[],
  workflows: ProductWorkflowResult[],
): MessageDto[] {
  const byConfirmationId = new Map(
    workflows.map((workflow) => [workflow.confirmation_id, workflow]),
  );
  return messages.map((message) => {
    if (message.productWorkflow) return message;
    const confirmationId = /确认 ID：([^\r\n]+)/.exec(message.content)?.[1];
    const productWorkflow = confirmationId
      ? byConfirmationId.get(confirmationId.trim())
      : undefined;
    if (!productWorkflow) return message;
    return {
      ...message,
      content: removeArchivedProductWorkflowSummary(message.content),
      productWorkflow,
    };
  });
}

/**
 * 将后续 Executor 完成结果挂回同一轮 Planner 消息，供刷新后恢复 DAG 状态。
 */
export function attachExecutorResultsToPlannerMessages(
  messages: MessageDto[],
): MessageDto[] {
  const next = messages.map((message) => ({ ...message }));

  for (let resultIndex = 0; resultIndex < next.length; resultIndex += 1) {
    const message = next[resultIndex]!;
    const results = [
      ...(message.executorResult ? [message.executorResult] : []),
      ...(message.productWorkflow?.executor_results ?? []),
    ];

    for (const result of results) {
      for (let planIndex = resultIndex; planIndex >= 0; planIndex -= 1) {
        const plannerMessage = next[planIndex]!;
        if (
          !plannerMessage.taskExecutionPlan?.tasks.some(
            (task) => task.task_id === result.task_id,
          )
        ) {
          continue;
        }
        const existing = plannerMessage.executorResults ?? [];
        next[planIndex] = {
          ...plannerMessage,
          executorResults: [
            ...existing.filter((item) => item.task_id !== result.task_id),
            result,
          ],
        };
        break;
      }
    }
  }

  return next;
}

/**
 * 将 token_usage 记录挂回消息 DTO，优先使用 message_id，兼容旧记录的 agent_type 兜底。
 */
function attachTokenUsagesToMessages(
  messages: MessageDto[],
  tokenUsages: TokenUsageDto[],
): MessageDto[] {
  if (tokenUsages.length === 0) return messages;

  const additions = new Map<string, TokenUsageDto[]>();

  for (const usage of tokenUsages) {
    const target = findTokenUsageMessage(messages, usage);
    if (!target) continue;

    const existing = additions.get(target.id) ?? [];
    additions.set(target.id, [...existing, usage]);
  }

  if (additions.size === 0) return messages;

  return messages.map((message) => {
    const tokenUsageItems = additions.get(message.id);
    if (!tokenUsageItems?.length) return message;

    return {
      ...message,
      tokenUsages: [
        ...(message.tokenUsages ?? []),
        ...tokenUsageItems,
      ],
    };
  });
}

/**
 * 查找 token 用量所属消息；旧数据没有 message_id 时，按 Agent 类型和创建时间近似匹配。
 */
function findTokenUsageMessage(
  messages: MessageDto[],
  usage: TokenUsageDto,
): MessageDto | null {
  if (usage.messageId) {
    return messages.find((message) => message.id === usage.messageId) ?? null;
  }

  const candidates = messages.filter(
    (message) =>
      message.role === "assistant" &&
      message.type === usage.agentType,
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  const usageTime = Date.parse(usage.createdAt);
  const firstAfterUsage = candidates.find(
    (message) => Date.parse(message.timestamp) >= usageTime,
  );

  return firstAfterUsage ?? candidates[candidates.length - 1]!;
}

/**
 * 安全地将 unknown 类型的 JSON 字段解析为对象，非对象类型返回 null。
 */
function parseRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

/**
 * 持久化单个 Agent 的助手消息，同时写入推理内容和结构化用户输入。
 * 返回生成的消息 ID，供上层关联 token 用量等扩展数据。
 */
export async function persistAssistantMessage({
  conversationId,
  content,
  userInput,
  reasoningContent,
  toolCalls,
  subagentTraces,
  agentError,
  taskExecutionPlan,
  productWorkflow,
  type,
}: {
  conversationId: string;
  content: string;
  userInput: UserInputRecord[] | null;
  reasoningContent?: string;
  toolCalls?: ToolCallDto[];
  subagentTraces?: SubagentTraceDto[];
  agentError?: AgentErrorDto;
  taskExecutionPlan?: TaskExecutionPlan | null;
  productWorkflow?: ProductWorkflowResult | null;
  type: string;
}): Promise<string> {
  const messageId = randomUUID();

  await prisma.$transaction(async (tx) => {
    const meta = JSON.stringify({
      source: `${type}-agent`,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
      ...(subagentTraces && subagentTraces.length > 0
        ? { subagentTraces }
        : {}),
      ...(agentError ? { agentError } : {}),
      ...(taskExecutionPlan ? { taskExecutionPlan } : {}),
      ...(productWorkflow ? { productWorkflow } : {}),
    });

    // 按 Agent 类型写入 message.type，前端据此恢复对应阶段的展示顺序。
    await tx.$executeRaw`
      INSERT INTO "message" (
        "id",
        "conversation_id",
        "role",
        "content",
        "meta",
        "user_input",
        "type"
      )
      VALUES (
        ${messageId},
        ${conversationId},
        'assistant',
        ${content},
        ${meta}::jsonb,
        ${userInput ? JSON.stringify({ user_input: userInput }) : null}::jsonb,
        ${type}
      )
    `;

    await tx.$executeRaw`
      UPDATE "conversation"
      SET "last_message_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${conversationId}
    `;
  });

  return messageId;
}

/**
 * 从消息正文中移除指定 tagged block，避免结构化 JSON 原文在正文中重复展示。
 */
function removeTaggedBlock(
  content: string,
  startMarker: string,
  endMarker: string,
): string {
  let result = content;
  while (true) {
    const startIndex = result.indexOf(startMarker);
    if (startIndex === -1) return result.trim();
    const endIndex = result.indexOf(endMarker, startIndex);
    if (endIndex === -1) return result.trim();
    const blockEnd = endIndex + endMarker.length;
    result = `${result.slice(0, startIndex)}${result.slice(blockEnd)}`;
  }
}

/**
 * 移除旧版产品工作流归档摘要，避免恢复卡片后重复显示。
 */
function removeArchivedProductWorkflowSummary(content: string): string {
  return content
    .replace(
      /Planner SubAgent 已完成产品工作流汇总，结构化结果已归档。\s*确认 ID：[^\r\n]+\s*状态：[^\r\n]+\s*Executor 结果数：[^\r\n]+/g,
      "",
    )
    .trim();
}

/**
 * 只恢复前端可展示的工具调用字段，避免 meta 中混入非预期结构。
 */
function normalizeToolCalls(value: unknown[]): ToolCallDto[] {
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string") return [];

    return [
      {
        ...(typeof record.id === "string" ? { id: record.id } : {}),
        name: record.name,
        ...(isRecord(record.args) ? { args: record.args } : {}),
        ...(Object.prototype.hasOwnProperty.call(record, "result")
          ? { result: record.result }
          : {}),
        ...(typeof record.agentType === "string"
          ? { agentType: record.agentType }
          : {}),
        ...(record.status === "complete" || record.status === "running"
          ? { status: record.status }
          : {}),
      },
    ];
  });
}

/**
 * 只恢复 Orchestrator 过程栏需要的 SubAgent 轨迹字段。
 */
function normalizeSubagentTraces(value: unknown[]): SubagentTraceDto[] {
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;
    if (typeof record.subagentType !== "string") return [];

    return [
      {
        ...(typeof record.id === "string" ? { id: record.id } : {}),
        ...(typeof record.parentAgentType === "string"
          ? { parentAgentType: record.parentAgentType }
          : {}),
        subagentType: record.subagentType,
        ...(typeof record.description === "string"
          ? { description: record.description }
          : {}),
        ...(typeof record.thinking === "string"
          ? { thinking: record.thinking }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(record, "result")
          ? { result: record.result }
          : {}),
        status: record.status === "running" ? "running" : "complete",
      },
    ];
  });
}

/**
 * 校验数据库 meta 中的错误卡片，避免将任意 JSON 直接暴露给前端。
 */
function normalizeAgentError(value: unknown): AgentErrorDto | undefined {
  const error = parseRecord(value);
  if (!error || typeof error.message !== "string") return undefined;
  const retry = parseRecord(error.retryAction);
  const retryAction =
    retry?.type === "resume_executor_task" &&
    typeof retry.taskId === "string" &&
    typeof retry.agentType === "string"
      ? {
          type: "resume_executor_task" as const,
          taskId: retry.taskId,
          agentType: retry.agentType,
        }
      : undefined;

  return {
    ...(typeof error.agentType === "string"
      ? { agentType: error.agentType }
      : {}),
    message: error.message,
    ...(retryAction ? { retryAction } : {}),
  };
}

/**
 * 判断值是否是普通对象，用于恢复工具参数。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 兼容旧消息：早期工具结果可能被写进正文，这里将搜索 JSON 迁回工具卡片数据。
 */
function extractWebSearchToolCalls(content: string): {
  content: string;
  toolCalls: ToolCallDto[];
} {
  const toolCalls: ToolCallDto[] = [];
  let cleaned = "";
  let cursor = 0;

  while (cursor < content.length) {
    const startIndex = content.indexOf("{", cursor);
    if (startIndex === -1) {
      cleaned += content.slice(cursor);
      break;
    }

    const endIndex = findJsonObjectEnd(content, startIndex);
    if (endIndex === -1) {
      cleaned += content.slice(cursor);
      break;
    }

    const rawJson = content.slice(startIndex, endIndex + 1);
    const payload = parseWebSearchPayload(rawJson);
    if (!payload) {
      cleaned += content.slice(cursor, endIndex + 1);
      cursor = endIndex + 1;
      continue;
    }

    cleaned += content.slice(cursor, startIndex);
    toolCalls.push({
      name: "web_search",
      result: payload,
      agentType: "conversation",
    });
    cursor = endIndex + 1;
  }

  return { content: cleaned.trim(), toolCalls };
}

/**
 * 解析旧正文中的联网搜索 JSON，只有符合搜索结果形状时才迁移。
 */
function parseWebSearchPayload(rawJson: string): unknown | null {
  try {
    const value = JSON.parse(rawJson) as unknown;
    if (!isRecord(value)) return null;

    const hasQuery = typeof value.query === "string";
    const hasResults = Array.isArray(value.results);
    const hasSearchSource =
      typeof value.source === "string" || Array.isArray(value.warnings);

    return hasQuery && hasResults && hasSearchSource ? value : null;
  } catch {
    return null;
  }
}

/**
 * 找到从指定 `{` 开始的 JSON 对象结尾，正确跳过字符串中的大括号。
 */
function findJsonObjectEnd(content: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < content.length; index++) {
    const char = content[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth++;
      continue;
    }
    if (char === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }

  return -1;
}
