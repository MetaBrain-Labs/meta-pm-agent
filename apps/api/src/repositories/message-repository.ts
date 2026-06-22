import { randomUUID } from "node:crypto";
import { prisma } from "@repo/database";
import {
  type ChatMessage,
  type ExecutorAgentResult,
  type ProductDirectorWorkflowResult,
  type RequestAnalysis,
  type TaskExecutionPlan,
} from "@repo/shared";
import {
  parseUserInputPayload,
  type UserInputRecord,
} from "../utils/user-input";
import { parseRequestAnalysisPayload } from "../utils/request-analysis";
import { parseTaskExecutionPlanPayload } from "../utils/task-execution";
import {
  parseExecutorResultPayload,
  parseProductWorkflowPayload,
} from "../utils/product-workflow";

/**
 * 数据库 message 表原始行结构。
 */
interface MessageRow {
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
  userInput?: UserInputRecord[] | null;
  requestAnalysis?: RequestAnalysis | null;
  taskExecutionPlan?: TaskExecutionPlan | null;
  executorResult?: ExecutorAgentResult | null;
  executorResults?: ExecutorAgentResult[];
  productWorkflow?: ProductDirectorWorkflowResult | null;
}

/**
 * 前端展示工具调用卡片所需的最小结构。
 */
export interface ToolCallDto {
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
  agentType?: string;
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

  return attachExecutorResultsToPlannerMessages(rows.map(mapMessageRow));
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
function mapMessageRow(row: MessageRow): MessageDto {
  const meta = parseRecord(row.meta);
  const userInput = parseRecord(row.user_input);

  // 旧消息可能只把 tagged block 存在正文里，读取历史消息时需要从正文回填结构化字段。
  const inlineUserInput = parseUserInputPayload(row.content);
  const inlineRequestAnalysis = parseRequestAnalysisPayload(row.content);
  const inlineTaskExecutionPlan = parseTaskExecutionPlanPayload(row.content);
  const inlineExecutorResult = parseExecutorResultPayload(row.content);
  const inlineProductWorkflow = parseProductWorkflowPayload(row.content);

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
    userInput: Array.isArray(userInput?.user_input)
      ? (userInput.user_input as UserInputRecord[])
      : inlineUserInput,
    requestAnalysis: inlineRequestAnalysis,
    taskExecutionPlan: inlineTaskExecutionPlan,
    executorResult: inlineExecutorResult,
    productWorkflow: inlineProductWorkflow,
  };
}

/**
 * 将后续 Executor 完成结果挂回同一轮 Planner 消息，供刷新后恢复 DAG 状态。
 */
function attachExecutorResultsToPlannerMessages(
  messages: MessageDto[],
): MessageDto[] {
  const productWorkflowResults = messages.flatMap((message) =>
    message.productWorkflow?.executor_results ?? [],
  );

  return messages.map((message) => {
    if (!message.taskExecutionPlan) return message;

    const taskIds = new Set(
      message.taskExecutionPlan.tasks.map((task) => task.task_id),
    );
    const executorResults =
      productWorkflowResults.length > 0
        ? productWorkflowResults
        : messages.flatMap((candidate) =>
            candidate.executorResult ? [candidate.executorResult] : [],
          );

    return {
      ...message,
      executorResults: executorResults.filter((result) =>
        taskIds.has(result.task_id),
      ),
    };
  });
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
 */
export async function persistAssistantMessage({
  conversationId,
  content,
  userInput,
  reasoningContent,
  toolCalls,
  type,
}: {
  conversationId: string;
  content: string;
  userInput: UserInputRecord[] | null;
  reasoningContent?: string;
  toolCalls?: ToolCallDto[];
  type: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const meta = JSON.stringify({
      source: `${type}-agent`,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
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
        ${randomUUID()},
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
}

/**
 * 从消息正文中移除指定 tagged block，避免结构化 JSON 原文在正文中重复展示。
 */
function removeTaggedBlock(
  content: string,
  startMarker: string,
  endMarker: string,
): string {
  const startIndex = content.indexOf(startMarker);
  if (startIndex === -1) return content;

  const endIndex = content.indexOf(endMarker, startIndex);
  if (endIndex === -1) return content;

  const blockEnd = endIndex + endMarker.length;
  return `${content.slice(0, startIndex)}${content.slice(blockEnd)}`.trim();
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
        name: record.name,
        ...(isRecord(record.args) ? { args: record.args } : {}),
        ...(Object.prototype.hasOwnProperty.call(record, "result")
          ? { result: record.result }
          : {}),
        ...(typeof record.agentType === "string"
          ? { agentType: record.agentType }
          : {}),
      },
    ];
  });
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
