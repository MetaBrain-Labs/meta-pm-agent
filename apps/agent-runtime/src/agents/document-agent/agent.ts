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
  createMiddleware,
} from "langchain";
import { createDeepAgent, type SubAgent } from "deepagents";
import type {
  DocumentTodo,
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
} from "@repo/shared";
import { calculateCost } from "../../config";
import { createDefaultAgentMiddleware } from "../common/middleware";
import { createChatModel } from "../common/model";
import {
  createAgentRunSummaryMiddleware,
  createAgentRunSummaryRecorder,
} from "../common/agent-run-summary";
import {
  getReasoningContent,
  getTextContent,
  getTokenUsage,
} from "../../utils/message-adapter";
import { PRD_DOCUMENT_AGENT_PROMPT, PRD_DOCUMENT_SUBAGENTS } from "./prompt";

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
  attemptNumber?: number;
  revisionFeedback?: string;
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
const DOCUMENT_AGENT_BLOCKED_TOOL_NAMES = new Set([
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "execute",
]);
const SUBAGENT_RUNTIME_CONTEXT_MAX_CHARS = 120_000;
const PRD_MARKDOWN_START_PATTERNS = [
  /^#{1,2}\s+.*Product Requirements Document\s*\(PRD\).*$/im,
  /^#{1,2}\s+.*产品需求文档.*PRD.*$/im,
  /^#{1,2}\s+.*PRD.*$/im,
];

/**
 * 运行 PRD Document Agent，返回最终 Markdown 文档。
 */
export async function* streamPrdDocumentAgent(
  input: PrdDocumentAgentInput,
): AsyncGenerator<DocumentAgentStreamEvent, string, void> {
  const startTime = Date.now();
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;
  const documentToolFilterMiddleware =
    createDocumentAgentToolFilterMiddleware();
  const agentPayload = {
    task: "Generate a complete PRD from the supplied product knowledge graph.",
    workspaceId: input.workspaceId,
    runId: input.runId,
    attemptNumber: input.attemptNumber ?? 1,
    revisionFeedback: input.revisionFeedback ?? "",
    taskDelegationPolicy:
      "When using task subagents, include all relevant graph nodes, relations, section dossier evidence, and draft excerpts directly in the task description. Subagents must not look for files or external graph context.",
    graph: input.graph,
    sectionDossiers: input.dossiers,
  };
  const summaryRecorder = createAgentRunSummaryRecorder({
    agentLabel: "PRD Document Agent",
    agentName: "document-agent-prd",
    agentType: "document",
    context: {
      payload: agentPayload,
      subagents: PRD_DOCUMENT_SUBAGENTS.map((subagent) => ({
        name: subagent.name,
        description: subagent.description,
      })),
      systemPrompt: PRD_DOCUMENT_AGENT_PROMPT,
      visibleTools: [...VISIBLE_BUILTIN_TOOL_NAMES],
    },
  });
  let responseText = "";

  try {
    const agent = createDeepAgent({
      model: createChatModel({
        enableThinking: false,
        temperature: 0.2,
        maxTokens: 24000,
      }) as any,
      systemPrompt: PRD_DOCUMENT_AGENT_PROMPT,
      name: "document-agent-prd",
      subagents: createRuntimePrdSubagents(
        input,
        documentToolFilterMiddleware,
      ) as any,
      middleware: [
        documentToolFilterMiddleware,
        ...createDefaultAgentMiddleware(),
        ...createAgentRunSummaryMiddleware(summaryRecorder),
      ] as any,
    });

    const run = await agent.stream(
      {
        messages: [new HumanMessage(JSON.stringify(agentPayload))],
      },
      { streamMode: "messages", signal: input.signal },
    );

    let currentTextBlock = "";
    for await (const [message] of run) {
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
        // 工具结果只进入可观察事件，不参与最终 Markdown 拼接。
        currentTextBlock = "";
        continue;
      }

      const reasoning = getReasoningContent(message);
      if (reasoning) {
        summaryRecorder.recordThinking(reasoning);
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
 * 创建 Document Agent 专用工具过滤中间件。
 */
function createDocumentAgentToolFilterMiddleware() {
  return createMiddleware({
    name: "DocumentAgentToolFilterMiddleware",
    wrapModelCall: async (request, handler) => {
      // 文档由业务数据库持久化，生成阶段只允许规划和子任务编排工具。
      const tools = request.tools?.filter(
        (tool) => !DOCUMENT_AGENT_BLOCKED_TOOL_NAMES.has(getToolName(tool)),
      );

      return handler({
        ...request,
        tools,
      });
    },
  });
}

/**
 * 提取工具名称。
 */
function getToolName(tool: { name?: unknown }): string {
  return typeof tool.name === "string" ? tool.name : "";
}

/**
 * 为 PRD 子代理注入当前运行的知识图谱上下文。
 */
function createRuntimePrdSubagents(
  input: PrdDocumentAgentInput,
  documentToolFilterMiddleware: ReturnType<
    typeof createDocumentAgentToolFilterMiddleware
  >,
): SubAgent[] {
  const runtimeContext = createSubagentRuntimeContext(input);

  return PRD_DOCUMENT_SUBAGENTS.map((subagent) => ({
    ...subagent,
    systemPrompt: `${subagent.systemPrompt}\n\n${runtimeContext}`,
    middleware: [
      ...((subagent as { middleware?: unknown[] }).middleware ?? []),
      documentToolFilterMiddleware,
    ],
  })) as SubAgent[];
}

/**
 * 构造子代理可直接读取的紧凑知识图谱上下文。
 */
function createSubagentRuntimeContext(input: PrdDocumentAgentInput): string {
  const context = JSON.stringify({
    workspaceId: input.workspaceId,
    runId: input.runId,
    attemptNumber: input.attemptNumber ?? 1,
    revisionFeedback: input.revisionFeedback ?? "",
    graph: {
      nodes: input.graph.nodes.map(compactKnowledgeGraphNode),
      relations: input.graph.relations.map(compactKnowledgeGraphRelation),
    },
    sectionDossiers: input.dossiers,
  });
  const compactContext =
    context.length > SUBAGENT_RUNTIME_CONTEXT_MAX_CHARS
      ? `${context.slice(0, SUBAGENT_RUNTIME_CONTEXT_MAX_CHARS)}`
      : context;
  const truncationNote =
    context.length > SUBAGENT_RUNTIME_CONTEXT_MAX_CHARS
      ? "\nThe runtime context was truncated for token budget. Use the available evidence and explicitly mark gaps."
      : "";

  return [
    "Runtime knowledge graph context:",
    "Use this context as the authoritative product graph even if the delegated task description is short.",
    "Do not claim that no knowledge graph evidence was provided unless this runtime context is empty.",
    `<knowledge_graph_context>${compactContext}</knowledge_graph_context>${truncationNote}`,
  ].join("\n");
}

/**
 * 压缩知识图谱节点，保留生成 PRD 所需字段。
 */
function compactKnowledgeGraphNode(node: KnowledgeGraphEntity) {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    description: node.description,
    source_task_id: node.source_task_id,
    status: node.status,
  };
}

/**
 * 压缩知识图谱关系，保留生成 PRD 所需字段。
 */
function compactKnowledgeGraphRelation(relation: KnowledgeGraphRelation) {
  return {
    id: relation.id,
    type: relation.type,
    source: relation.source,
    target: relation.target,
    description: relation.description,
    source_task_id: relation.source_task_id,
  };
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
