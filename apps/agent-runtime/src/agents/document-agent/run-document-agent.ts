/**
 * Document Agent 专用运行器
 *
 * 独立承载 Document Agent 的 DeepAgents 创建、SubAgent task 记录、write_todos
 * 任务规划事件转换、token 用量统计和最终 PRD Markdown 清理逻辑。
 *
 * Responsibilities:
 * - runDocumentAgent()：运行带 PRD 子代理的 Document Agent
 * - 将 write_todos/task 内置工具转换为文档工作流事件
 * - 清理最终 Markdown，避免持久化 DeepAgents 编排说明
 *
 * Notes:
 * - 本模块不复用 runJsonAgent 或 runAgentWithSubagent。
 * - Document Agent 不写知识图谱；知识图谱只作为输入事实源。
 */

import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "langchain";
import { createDeepAgent, type SubAgent } from "deepagents";
import type { DocumentTodo } from "@repo/shared";
import { calculateCost } from "../../config";
import {
  createAgentRunSummaryMiddleware,
  createAgentRunSummaryRecorder,
  createSubagentTaskCallExtractor,
  extractSubagentTaskResult,
} from "../common/agent-run-summary";
import { createDeepAgentToolAllowlistMiddleware } from "../common/deep-agent-tool-policy";
import { createDefaultAgentMiddleware } from "../common/middleware";
import { createChatModel } from "../common/model";
import {
  getReasoningContent,
  getTextContent,
  getTokenUsage,
} from "../../utils/message-adapter";
import { PRD_DOCUMENT_AGENT_PROMPT } from "./prompt";

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

/**
 * Document Agent 专属运行配置。
 */
export interface RunDocumentAgentOptions {
  payload: unknown;
  subagents: SubAgent[];
  signal?: AbortSignal;
}

const VISIBLE_BUILTIN_TOOL_NAMES = new Set(["write_todos", "task"]);
const PRD_MARKDOWN_START_PATTERNS = [
  /^#{1,2}\s+.*Product Requirements Document\s*\(PRD\).*$/im,
  /^#{1,2}\s+.*产品需求文档.*PRD.*$/im,
  /^#{1,2}\s+.*PRD.*$/im,
];

/**
 * 运行 Document Agent，并返回清理后的 PRD Markdown。
 */
export async function* runDocumentAgent(
  options: RunDocumentAgentOptions,
): AsyncGenerator<DocumentAgentStreamEvent, string, void> {
  const startTime = Date.now();
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;
  let responseText = "";
  const documentToolAllowlistMiddleware =
    createDeepAgentToolAllowlistMiddleware({
      agentName: "document-agent-prd",
      allowedToolNames: VISIBLE_BUILTIN_TOOL_NAMES,
    });
  const summaryRecorder = createAgentRunSummaryRecorder({
    agentLabel: "PRD Document Agent",
    agentName: "document-agent-prd",
    agentType: "document",
    context: {
      payload: options.payload,
      subagents: options.subagents.map((subagent) => ({
        name: subagent.name,
        description: subagent.description,
      })),
      systemPrompt: PRD_DOCUMENT_AGENT_PROMPT,
      visibleTools: [...VISIBLE_BUILTIN_TOOL_NAMES],
    },
  });

  try {
    const agent = createDeepAgent({
      model: createChatModel({
        enableThinking: false,
        temperature: 0.2,
        maxTokens: 24000,
      }) as any,
      systemPrompt: PRD_DOCUMENT_AGENT_PROMPT,
      name: "document-agent-prd",
      subagents: options.subagents as any,
      middleware: [
        documentToolAllowlistMiddleware,
        ...createDefaultAgentMiddleware(),
        ...createAgentRunSummaryMiddleware(summaryRecorder),
      ] as any,
    });

    const run = await agent.stream(
      {
        messages: [new HumanMessage(JSON.stringify(options.payload))],
      },
      { streamMode: "messages", signal: options.signal },
    );

    let currentTextBlock = "";
    /** 跟踪 task 工具调用中 tool_call_id -> subagentType 的映射，用于结果匹配。 */
    const taskCallToSubagent = new Map<string, string>();
    const subagentTaskCallExtractor = createSubagentTaskCallExtractor();
    for await (const [message] of run) {
      const subagentTaskCalls = subagentTaskCallExtractor.extract(message);
      for (const taskCall of subagentTaskCalls) {
        if (taskCall.toolCallId) {
          taskCallToSubagent.set(taskCall.toolCallId, taskCall.subagentType);
        }
        summaryRecorder.recordSubagentCall({
          toolCallId: taskCall.toolCallId,
          subagentType: taskCall.subagentType,
          input: taskCall.input,
        });
      }
      // 同时读取 task 和 write_todos，前者用于子代理观测，后者用于用户可见任务规划。
      const visibleToolCalls = getVisibleBuiltinToolCalls(message);
      const hasAnyToolCalls =
        AIMessage.isInstance(message) && (message.tool_calls?.length ?? 0) > 0;
      for (const toolCall of visibleToolCalls) {
        const todos = extractTodosFromToolArgs(toolCall.args);
        if (todos.length > 0) {
          yield {
            type: "todo-update",
            agentType: "document",
            todos,
          };
        }
        summaryRecorder.recordToolCall({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolArgs: toolCall.args,
        });
        yield {
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolArgs: toolCall.args,
          agentType: "document",
        };
      }
      if (hasAnyToolCalls) {
        // 带工具调用的 AI 文本通常是 DeepAgents 子任务编排说明，不属于最终 PRD 正文。
        currentTextBlock = "";
        continue;
      }

      const toolResult = getVisibleBuiltinToolResult(message);
      if (toolResult) {
        const compactedResult = compactToolResult(toolResult.content);
        summaryRecorder.recordToolResult({
          toolCallId: toolResult.id,
          toolName: toolResult.name,
          toolResult: compactedResult,
        });
        yield {
          type: "tool-result",
          toolCallId: toolResult.id,
          toolName: toolResult.name,
          toolResult: compactedResult,
          agentType: "document",
        };
        currentTextBlock = "";
        continue;
      }
      if (ToolMessage.isInstance(message)) {
        const subagentTaskResult = extractSubagentTaskResult(
          message,
          taskCallToSubagent,
        );
        if (subagentTaskResult) {
          summaryRecorder.recordSubagentResult({
            toolCallId: subagentTaskResult.toolCallId,
            subagentType: subagentTaskResult.subagentType,
            output: subagentTaskResult.output,
          });
        } else if (message.name === "task") {
          const toolCallId = (message as { tool_call_id?: string }).tool_call_id;
          const subagentType =
            (toolCallId ? taskCallToSubagent.get(toolCallId) : undefined) ??
            "unknown";
          summaryRecorder.recordSubagentResult({
            toolCallId,
            subagentType,
            output: message.content,
          });
        }
        currentTextBlock = "";
        continue;
      }

      const reasoning = getReasoningContent(message);
      if (reasoning) {
        const attributedToSubagent =
          subagentTaskCalls.length === 0 &&
          summaryRecorder.recordSubagentThinking({ content: reasoning });
        if (!attributedToSubagent) {
          summaryRecorder.recordThinking(reasoning);
        }
        yield {
          type: "reasoning",
          agentType: "document",
          content: reasoning,
        };
      }
      const text = getTextContent(message);
      if (text) {
        currentTextBlock += text;
        responseText = currentTextBlock;
        summaryRecorder.recordOutput(text);
      }

      const usage = getTokenUsage(message);
      if (usage) {
        tokenUsage = usage;
      }
    }

    const tokenUsageSummary = tokenUsage
      ? {
          ...tokenUsage,
          durationMs: Date.now() - startTime,
        }
      : undefined;
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

    const markdown = sanitizePrdMarkdown(responseText);
    if (!markdown) {
      throw new Error("Document Agent completed without PRD markdown.");
    }

    await summaryRecorder.finish({
      output: markdown,
      status: "completed",
      tokenUsage: tokenUsageSummary,
    });
    return markdown;
  } catch (error) {
    await summaryRecorder.finish({
      error: getErrorMessage(error),
      output: responseText,
      status: "failed",
      tokenUsage: tokenUsage
        ? {
            ...tokenUsage,
            durationMs: Date.now() - startTime,
          }
        : undefined,
    });
    throw error;
  }
}

/**
 * 清理 Document Agent 最终 Markdown，剔除 DeepAgents 子任务编排说明。
 */
export function sanitizePrdMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return "";

  for (const pattern of PRD_MARKDOWN_START_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match?.index !== undefined && match.index >= 0) {
      return trimmed.slice(match.index).trim();
    }
  }

  return trimmed;
}

/**
 * 提取异常的可读消息，用于本地汇总文件。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 提取 Document Agent 可展示的内置工具调用。
 */
function getVisibleBuiltinToolCalls(message: BaseMessage): Array<{
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
function getVisibleBuiltinToolResult(message: BaseMessage): {
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
    value === "pending" || value === "in_progress" || value === "completed"
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
