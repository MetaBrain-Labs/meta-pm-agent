/**
 * Document Agent 执行器
 *
 * 使用 Deep Agents 生成产品文档，并把内置 write_todos/task 工具调用转换成
 * 文档工作流可观察事件。当前实现 PRD 工作流，后续 MRD/BRD 可在同一 Agent
 * 目录下增加独立提示词和执行入口。
 *
 * Responsibilities:
 * - streamPrdDocumentAgent()：基于知识图谱生成 PRD Markdown
 * - 抽取 write_todos 任务规划并转换为 todo-update 事件
 * - 透传 task 子代理调用、推理和 token 用量，供后台任务记录状态
 *
 * Notes:
 * - Document Agent 不写知识图谱；知识图谱是输入事实源。
 */

import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "langchain";
import { createDeepAgent } from "deepagents";
import type {
  DocumentTodo,
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
} from "@repo/shared";
import { calculateCost } from "../../config";
import { createDefaultAgentMiddleware } from "../common/middleware";
import { createChatModel } from "../common/model";
import {
  getReasoningContent,
  getTextContent,
  getTokenUsage,
} from "../../utils/message-adapter";
import {
  PRD_DOCUMENT_AGENT_PROMPT,
  PRD_DOCUMENT_SUBAGENTS,
} from "./prompt";

/**
 * Document Agent 的输入载荷。
 */
export interface PrdDocumentAgentInput {
  workspaceId: string;
  runId: string;
  graph: {
    nodes: KnowledgeGraphEntity[];
    relations: KnowledgeGraphRelation[];
  };
  dossiers: Array<{
    id: string;
    title: string;
    purpose: string;
    nodeIds: string[];
    relationIds: string[];
    evidence: string[];
  }>;
  signal?: AbortSignal;
}

/**
 * Document Agent 暴露给 LangGraph/API 的流式事件。
 */
export type DocumentAgentStreamEvent =
  | {
      type: "reasoning";
      agentType: "document";
      content: string;
    }
  | {
      type: "todo-update";
      agentType: "document";
      todos: DocumentTodo[];
    }
  | {
      type: "tool-call";
      toolCallId?: string;
      toolName: "write_todos" | "task";
      toolArgs?: Record<string, unknown>;
      agentType: "document";
    }
  | {
      type: "tool-result";
      toolCallId?: string;
      toolName: "write_todos" | "task";
      toolResult: unknown;
      agentType: "document";
    }
  | {
      type: "token-usage";
      agentType: "document";
      inputTokens: number;
      cacheHitInputTokens: number;
      cacheMissInputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costInput: number;
      costOutput: number;
      costTotal: number;
      durationMs: number;
    };

const VISIBLE_BUILTIN_TOOL_NAMES = new Set(["write_todos", "task"]);

/**
 * 运行 PRD Document Agent，返回最终 Markdown 文档。
 */
export async function* streamPrdDocumentAgent(
  input: PrdDocumentAgentInput,
): AsyncGenerator<DocumentAgentStreamEvent, string, void> {
  const startTime = Date.now();
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;

  const agent = createDeepAgent({
    model: createChatModel({
      enableThinking: false,
      temperature: 0.2,
      maxTokens: 12000,
    }) as any,
    systemPrompt: PRD_DOCUMENT_AGENT_PROMPT,
    name: "document-agent-prd",
    subagents: PRD_DOCUMENT_SUBAGENTS,
    middleware: createDefaultAgentMiddleware() as any,
  });

  const run = await agent.stream(
    {
      messages: [
        new HumanMessage(
          JSON.stringify({
            task: "Generate a complete PRD from the supplied product knowledge graph.",
            workspaceId: input.workspaceId,
            runId: input.runId,
            graph: input.graph,
            sectionDossiers: input.dossiers,
          }),
        ),
      ],
    },
    { streamMode: "messages", signal: input.signal },
  );

  let responseText = "";
  for await (const [message] of run) {
    for (const toolCall of getVisibleBuiltinToolCalls(message)) {
      const todos = extractTodosFromToolArgs(toolCall.args);
      if (todos.length > 0) {
        yield {
          type: "todo-update",
          agentType: "document",
          todos,
        };
      }
      yield {
        type: "tool-call",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        toolArgs: toolCall.args,
        agentType: "document",
      };
    }

    const toolResult = getVisibleBuiltinToolResult(message);
    if (toolResult) {
      yield {
        type: "tool-result",
        toolCallId: toolResult.id,
        toolName: toolResult.name,
        toolResult: compactToolResult(toolResult.content),
        agentType: "document",
      };
      continue;
    }

    const reasoning = getReasoningContent(message);
    if (reasoning) {
      yield {
        type: "reasoning",
        agentType: "document",
        content: reasoning,
      };
    }
    responseText += getTextContent(message);

    const usage = getTokenUsage(message);
    if (usage) {
      tokenUsage = usage;
    }
  }

  if (tokenUsage) {
    const cost = calculateCost(
      tokenUsage.cacheMissInputTokens,
      tokenUsage.cacheHitInputTokens,
      tokenUsage.outputTokens,
    );
    yield {
      type: "token-usage",
      agentType: "document",
      inputTokens: tokenUsage.inputTokens,
      cacheHitInputTokens: tokenUsage.cacheHitInputTokens,
      cacheMissInputTokens: tokenUsage.cacheMissInputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      costInput: cost.costInput,
      costOutput: cost.costOutput,
      costTotal: cost.costTotal,
      durationMs: Date.now() - startTime,
    };
  }

  const markdown = responseText.trim();
  if (!markdown) {
    throw new Error("Document Agent completed without PRD markdown.");
  }

  return markdown;
}

/**
 * 提取 Document Agent 可展示的内置工具调用。
 */
function getVisibleBuiltinToolCalls(
  message: BaseMessage,
): Array<{
  id?: string;
  name: "write_todos" | "task";
  args?: Record<string, unknown>;
}> {
  if (!AIMessage.isInstance(message)) return [];

  return (message.tool_calls ?? [])
    .filter((toolCall) => VISIBLE_BUILTIN_TOOL_NAMES.has(toolCall.name))
    .map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name as "write_todos" | "task",
      args:
        typeof toolCall.args === "object" && toolCall.args !== null
          ? (toolCall.args as Record<string, unknown>)
          : undefined,
    }));
}

/**
 * 提取 Document Agent 可展示的内置工具结果。
 */
function getVisibleBuiltinToolResult(
  message: BaseMessage,
): {
  id?: string;
  name: "write_todos" | "task";
  content: unknown;
} | null {
  if (!ToolMessage.isInstance(message)) return null;
  const name = message.name ?? "";
  if (!VISIBLE_BUILTIN_TOOL_NAMES.has(name)) return null;

  return {
    id: (message as { tool_call_id?: string }).tool_call_id,
    name: name as "write_todos" | "task",
    content: message.content,
  };
}

/**
 * 从 write_todos 工具参数中提取任务规划。
 */
function extractTodosFromToolArgs(
  args: Record<string, unknown> | undefined,
): DocumentTodo[] {
  const todos = args?.todos;
  if (!Array.isArray(todos)) return [];

  return todos
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const todo = item as Record<string, unknown>;
      const content = todo.content;
      const status = todo.status;
      if (typeof content !== "string" || !isTodoStatus(status)) return null;

      return {
        index,
        content,
        status,
      };
    })
    .filter((item): item is DocumentTodo => item !== null);
}

/**
 * 判断工具返回的任务状态是否可展示。
 */
function isTodoStatus(value: unknown): value is DocumentTodo["status"] {
  return (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed"
  );
}

/**
 * 压缩大型子代理报告，避免后台运行状态记录过重。
 */
function compactToolResult(content: unknown): unknown {
  const text =
    typeof content === "string" ? content : JSON.stringify(content ?? "");
  if (text.length <= 1200) return content;

  return `${text.slice(0, 1200).trimEnd()}...`;
}
