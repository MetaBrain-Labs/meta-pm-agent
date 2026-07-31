/**
 * Document Agent 专用运行器
 *
 * 独立承载 Document Agent 的 DeepAgents 创建、Skill 读取审计、
 * token 用量统计和最终 PRD Markdown 清理逻辑。
 *
 * Responsibilities:
 * - runDocumentAgent()：运行直接使用 PRD Skills 的 Document Agent
 * - 保留兼容的工具事件转换边界
 * - 清理最终 Markdown，避免持久化 DeepAgents 编排说明
 *
 * Notes:
 * - 本模块拥有独立文档流式协议，不复用产品工作流 runAgent。
 * - Document Agent 不写知识图谱；知识图谱只作为输入事实源。
 */

import { createHash } from "node:crypto";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "langchain";
import {
  createDeepAgent,
  type FileData,
  type SubAgent,
} from "deepagents";
import type { DocumentTodo, ModelUsageProfile } from "@repo/shared";
import { calculateCost } from "../../config";
import {
  createAgentRunSummaryMiddleware,
  createAgentRunSummaryRecorder,
  createNamedToolCallExtractor,
  createSubagentTaskCallExtractor,
  extractSubagentTaskResult,
} from "../common/agent-run-summary";
import { createDeepAgentToolAllowlistMiddleware } from "../common/deep-agent-tool-policy";
import { createDefaultAgentMiddleware } from "../common/middleware";
import { createChatModel } from "../common/model";
import {
  createModelSummarySnapshot,
  resolveAgentModelSelection,
  toLlmPricing,
} from "../common/model-profile";
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
  skills?: string[];
  skillFiles?: Record<string, FileData>;
  modelProfile?: ModelUsageProfile;
  signal?: AbortSignal;
}

export const DOCUMENT_VISIBLE_BUILTIN_TOOL_NAMES = [] as const;
const VISIBLE_BUILTIN_TOOL_NAMES = new Set<string>(
  DOCUMENT_VISIBLE_BUILTIN_TOOL_NAMES,
);
const SKILL_READER_TOOL_NAME = "read_file";

/**
 * 计算 Document Agent 内置工具白名单；Skill 读取保持内部可用但不进入可见工具集合。
 */
export function createDocumentAllowedBuiltinToolNames(
  hasSkillFiles: boolean,
): Set<string> {
  return new Set([
    ...DOCUMENT_VISIBLE_BUILTIN_TOOL_NAMES,
    ...(hasSkillFiles ? [SKILL_READER_TOOL_NAME] : []),
  ]);
}
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
  const modelSelection = resolveAgentModelSelection(
    options.modelProfile,
    "document",
  );
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;
  let responseText = "";
  const skillFiles = options.skillFiles ?? {};
  const hasSkillFiles = Object.keys(skillFiles).length > 0;
  const allowedBuiltinToolNames =
    createDocumentAllowedBuiltinToolNames(hasSkillFiles);
  const documentToolAllowlistMiddleware =
    createDeepAgentToolAllowlistMiddleware({
      agentName: "document-agent-prd",
      allowedToolNames: allowedBuiltinToolNames,
    });
  const summaryRecorder = createAgentRunSummaryRecorder({
    agentLabel: "PRD Document Agent",
    agentName: "document-agent-prd",
    agentType: "document",
    model: createModelSummarySnapshot(modelSelection),
    context: {
      payload: options.payload,
      subagents: options.subagents.map((subagent) => ({
        name: subagent.name,
        description: subagent.description,
        skills: subagent.skills ?? [],
      })),
      skills: options.skills ?? [],
      skillManifest: createSkillManifest(skillFiles),
      systemPrompt: PRD_DOCUMENT_AGENT_PROMPT,
      visibleTools: [...VISIBLE_BUILTIN_TOOL_NAMES],
    },
  });

  try {
    const agent = createDeepAgent({
      model: createChatModel(
        {
          enableThinking: true,
          temperature: 0.2,
          maxTokens: 24000,
        },
        modelSelection,
      ) as any,
      systemPrompt: PRD_DOCUMENT_AGENT_PROMPT,
      name: "document-agent-prd",
      skills: options.skills ?? [],
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
        ...(hasSkillFiles ? { files: skillFiles } : {}),
      },
      { streamMode: "messages", signal: options.signal },
    );

    let currentTextBlock = "";
    /** 跟踪 task 工具调用中 tool_call_id -> subagentType 的映射，用于结果匹配。 */
    const taskCallToSubagent = new Map<string, string>();
    /** Debug-only Skill 读取审计；不进入 SSE 或业务持久化。 */
    const skillReadCallPaths = new Map<string, string>();
    const subagentTaskCallExtractor = createSubagentTaskCallExtractor();
    const skillReadCallExtractor = createNamedToolCallExtractor(
      SKILL_READER_TOOL_NAME,
      (input) =>
        typeof input.file_path === "string" &&
        input.file_path.startsWith("/skills/") &&
        input.file_path.endsWith("/SKILL.md"),
    );
    for await (const [message] of run) {
      for (const skillRead of skillReadCallExtractor.extract(message)) {
        const filePath = String(skillRead.input.file_path);
        if (skillRead.toolCallId) {
          skillReadCallPaths.set(skillRead.toolCallId, filePath);
        }
        summaryRecorder.recordToolCall({
          toolCallId: skillRead.toolCallId,
          toolName: "read_file",
          toolArgs: {
            file_path: filePath,
            auditScope: "virtual-skill",
          },
        });
      }
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

      const skillReadResult = getSkillReadToolResult(
        message,
        skillReadCallPaths,
      );
      if (skillReadResult) {
        summaryRecorder.recordToolResult({
          toolCallId: skillReadResult.toolCallId,
          toolName: "read_file",
          toolResult: {
            filePath: skillReadResult.filePath,
            success: skillReadResult.success,
            sha256: skillReadResult.sha256,
          },
        });
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
        toLlmPricing(modelSelection),
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
      throw new Error(
        "Document Agent returned no PRD markdown. The model may have exhausted maxTokens during reasoning; increase the Document model maxTokens or lower its reasoning effort.",
      );
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
 * 构建只包含虚拟路径和内容摘要的 Skill 清单，供本地 Debug 汇总审计。
 */
function createSkillManifest(skillFiles: Record<string, FileData>) {
  return Object.entries(skillFiles).map(([filePath, file]) => ({
    filePath,
    sha256: hashContent(file.content),
  }));
}

/**
 * 将虚拟 Skill 读取结果压缩为成功状态和内容 hash。
 */
function getSkillReadToolResult(
  message: BaseMessage,
  skillReadCallPaths: ReadonlyMap<string, string>,
): {
  toolCallId?: string;
  filePath: string;
  success: boolean;
  sha256: string | null;
} | null {
  if (!ToolMessage.isInstance(message) || message.name !== "read_file") {
    return null;
  }
  const toolCallId = (message as { tool_call_id?: string }).tool_call_id;
  const filePath = toolCallId
    ? skillReadCallPaths.get(toolCallId)
    : undefined;
  if (!filePath) return null;
  const content = stringifyToolContent(message.content);
  const success = !/^Error:/i.test(content.trim());

  return {
    toolCallId,
    filePath,
    success,
    sha256: success ? hashContent(content) : null,
  };
}

/**
 * 将工具内容稳定转换为 hash 输入。
 */
function stringifyToolContent(content: unknown): string {
  return typeof content === "string"
    ? content
    : JSON.stringify(content ?? "");
}

/**
 * 计算本地调试所需的 SHA-256 内容摘要。
 */
function hashContent(content: unknown): string {
  const normalized =
    typeof content === "string"
      ? content
      : content instanceof Uint8Array
        ? Buffer.from(content)
        : JSON.stringify(content ?? "");
  return createHash("sha256").update(normalized).digest("hex");
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
