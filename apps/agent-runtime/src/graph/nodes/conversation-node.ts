/**
 * Conversation Agent 图节点
 *
 * 将 Conversation Agent 纳入主 LangGraph，使每轮用户消息先经过对话整理节点，再进入
 * Planner intake 和后续产品工作流。
 *
 * Responsibilities:
 * - 在 LangGraph 内运行 Conversation Agent 并透传 reasoning/text/tool/token 事件
 * - 解析 Conversation Agent 输出的 workflow-resume 与 user-input tagged block
 * - 为已有 userInputBlock 的恢复路径提供跳过 Conversation Agent 的入口
 *
 * Notes:
 * - Conversation Agent 只负责整理用户输入和用户可见表达，不再判断闲聊或需求可执行性。
 */

import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "langchain";
import { getWriter, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { calculateCost } from "../../config";
import { createAgentRunSummaryRecorder } from "../../agents/common/agent-run-summary";
import {
  createConversationAgent,
  createConversationAgentSystemPrompt,
} from "../../agents/conversation/agent";
import {
  getReasoningContent,
  getTextContent,
  getTokenUsage,
  toLangChainMessages,
} from "../../utils/message-adapter";
import { streamTaggedBlock } from "../../utils/tagged-block-stream";
import type { ConversationStreamEvent } from "../../types";
import {
  createWorkflowContinuationResumeContextFromMessages,
} from "../../agents/conversation/workflow-resume";
import type { WorkflowGraphStateValue } from "../state";

const CONVERSATION_TAGGED_BLOCKS = [
  {
    startMarker: "<planner-intake-handoff",
    endMarker: "</planner-intake-handoff>",
    startEvent: "planner-intake-handoff-start" as const,
    completeEvent: "planner-intake-handoff-complete" as const,
  },
  {
    startMarker: "<question-form",
    endMarker: "</question-form>",
    startEvent: "question-form-start" as const,
    completeEvent: "question-form-complete" as const,
  },
  {
    startMarker: "<user-input",
    endMarker: "</user-input>",
    startEvent: "user-input-start" as const,
    completeEvent: "user-input-complete" as const,
  },
  {
    startMarker: "<workflow-resume",
    endMarker: "</workflow-resume>",
    startEvent: "workflow-resume-start" as const,
    completeEvent: "workflow-resume-complete" as const,
  },
];

/**
 * 执行 Conversation Agent 节点，产出后续 Planner intake 可读取的 userInputBlock。
 */
export async function conversationAgentNode(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  if (state.userInputBlock.trim()) {
    return {
      conversationOutcome: "ready_for_planner" as const,
      enabledTools: [],
      messages: [],
    };
  }

  if (state.messages.length === 0) {
    throw new Error("Conversation Agent requires chat messages.");
  }

  if (!shouldRunConversationModelForWorkflowResume(state)) {
    return emitDeterministicPlannerIntakeHandoff(state, config);
  }

  const writer = getWriter(config);
  const stream = streamTaggedBlock(
    streamGraphConversationAgentEvents(
      toLangChainMessages(state.messages),
      state,
      config?.signal,
    ),
    CONVERSATION_TAGGED_BLOCKS,
  );

  try {
    for await (const event of stream) {
      if (
        event.type === "workflow-resume-start" ||
        event.type === "planner-intake-handoff-start"
      ) {
        continue;
      }

      if (event.type === "planner-intake-handoff-complete") {
        return emitDeterministicPlannerIntakeHandoff(state, config);
      }

      if (event.type === "workflow-resume-complete") {
        writer?.(event);
        return {
          conversationOutcome: "workflow_resume" as const,
          enabledTools: [],
          messages: [],
        };
      }

      if (event.type === "user-input-complete") {
        writer?.({ type: "user-input-start" });
        writer?.({ type: "user-input-complete", content: event.content });
        return {
          conversationOutcome: "ready_for_planner" as const,
          enabledTools: [],
          messages: [],
          userInputBlock: event.content,
        };
      }

      if (event.type === "token-usage") {
        writer?.(event);
      }
    }
  } catch {
    return emitDeterministicPlannerIntakeHandoff(state, config);
  }

  return emitDeterministicPlannerIntakeHandoff(state, config);
}

/**
 * 普通消息直接交给 Planner Intake，避免 DeepAgents 默认任务指令污染用户可见输出。
 */
function emitDeterministicPlannerIntakeHandoff(
  state: WorkflowGraphStateValue,
  config?: LangGraphRunnableConfig,
) {
  const writer = getWriter(config);
  const userInputBlock = createRawUserInputBlock(state.messages);
  writer?.({ type: "user-input-start" });
  writer?.({ type: "user-input-complete", content: userInputBlock });

  return {
    conversationOutcome: "ready_for_planner" as const,
    enabledTools: [],
    messages: [],
    userInputBlock,
  };
}

/**
 * 只有历史中存在可恢复 workflow 产物时，才调用模型识别显式续跑意图。
 */
function shouldRunConversationModelForWorkflowResume(
  state: WorkflowGraphStateValue,
): boolean {
  return Boolean(
    createWorkflowContinuationResumeContextFromMessages({
      messages: state.messages,
      knowledgeGraph: undefined,
    }),
  );
}

/**
 * 流式运行 Conversation Agent，并将底层 LangChain 消息转换成运行时事件。
 */
async function* streamGraphConversationAgentEvents(
  messages: (HumanMessage | AIMessage)[],
  state: WorkflowGraphStateValue,
  signal: AbortSignal | undefined,
): AsyncGenerator<ConversationStreamEvent> {
  const startTime = Date.now();
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;
  let outputText = "";
  let completed = false;
  let failedError: unknown = null;
  const baseAgentOptions = {
    enabledTools: state.enabledTools,
    knowledgeGraph: state.knowledgeGraph,
  };
  const summaryRecorder = createAgentRunSummaryRecorder({
    agentLabel: "Conversation Agent",
    agentName: "conversation-agent",
    agentType: "conversation",
    context: {
      enabledTools: state.enabledTools ?? [],
      knowledgeGraph: state.knowledgeGraph ?? null,
      payload: {
        messages: compactConversationMessages(messages),
      },
      productContext: state.productContext,
      requestFormId: state.requestFormId,
      systemPrompt: createConversationAgentSystemPrompt(baseAgentOptions),
      workspaceId: state.workspaceId,
      workflowThreadId: state.workflowThreadId,
    },
  });

  try {
    const agent = createConversationAgent({
      ...baseAgentOptions,
      summaryRecorder,
    });
    const run = await agent.stream(
      { messages },
      { streamMode: "messages", signal },
    );

    for await (const [message] of run) {
      for (const toolCall of getToolCalls(message)) {
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
          agentType: "conversation",
        };
      }

      const toolResult = getToolResult(message);
      if (toolResult) {
        summaryRecorder.recordToolResult({
          toolCallId: toolResult.id,
          toolName: toolResult.name,
          toolResult: toolResult.content,
        });
        yield {
          type: "tool-result",
          toolCallId: toolResult.id,
          toolName: toolResult.name,
          toolResult: toolResult.content,
          agentType: "conversation",
        };
        continue;
      }

      const reasoning = getReasoningContent(message);
      if (reasoning) {
        summaryRecorder.recordThinking(reasoning);
        yield {
          type: "reasoning",
          content: reasoning,
          agentType: "conversation",
        };
      }

      const text = stripInternalNoise(getTextContent(message));
      if (text) {
        outputText += text;
        summaryRecorder.recordOutput(text);
        yield { type: "text", content: text, agentType: "conversation" };
      }

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
        agentType: "conversation",
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
    completed = true;
  } catch (error) {
    failedError = error;
    throw error;
  } finally {
    await summaryRecorder.finish({
      error: failedError,
      output: outputText,
      status: failedError ? "failed" : completed ? "completed" : "cancelled",
      tokenUsage: tokenUsage
        ? {
            ...tokenUsage,
            durationMs: Date.now() - startTime,
          }
        : undefined,
    });
  }
}

/**
 * 将最新用户原文包装成兼容旧持久化和前端展示的 user-input 块。
 */
function createRawUserInputBlock(
  messages: WorkflowGraphStateValue["messages"],
): string {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const content = normalizeMessageContent(latestUserMessage?.content);
  const payload = {
    user_input: content
      ? [
          {
            index: 1,
            content,
            type: "陈述",
          },
        ]
      : [],
  };

  return `<user-input>\n${JSON.stringify(payload, null, 2)}\n</user-input>`;
}

/**
 * 提取对 Planner Intake 有用的原始用户文本，避免把非字符串内容直接传入图状态。
 */
function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (content == null) return "";
  return JSON.stringify(content);
}

/**
 * 压缩会话上下文，避免把 LangChain Message 实例内部状态写入运行摘要。
 */
function compactConversationMessages(messages: BaseMessage[]): Array<{
  content: unknown;
  type: string;
}> {
  return messages.map((message) => ({
    content: message.content,
    type: getMessageType(message),
  }));
}

/**
 * 兼容不同 LangChain 版本的消息类型读取方式。
 */
function getMessageType(message: BaseMessage): string {
  const maybeTypedMessage = message as BaseMessage & {
    _getType?: () => string;
    getType?: () => string;
  };
  if (typeof maybeTypedMessage.getType === "function") {
    return maybeTypedMessage.getType();
  }
  if (typeof maybeTypedMessage._getType === "function") {
    return maybeTypedMessage._getType();
  }

  return message.constructor.name;
}

/**
 * 剪切 DeepAgents 环境噪声，避免泄露到用户正文。
 */
function stripInternalNoise(content: string): string {
  return content
    .replace(/(^|\n)No files found in\s+\/\s*/g, "$1")
    .replace(/(^|\n)No files found in\s+\.\s*/g, "$1");
}

/**
 * 从模型消息中提取用户授权工具调用。
 */
function getToolCalls(
  message: BaseMessage,
): Array<{ id?: string; name: string; args?: Record<string, unknown> }> {
  if (!AIMessage.isInstance(message)) return [];

  return (message.tool_calls ?? [])
    .filter((toolCall) => toolCall.name)
    .map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      args:
        typeof toolCall.args === "object" && toolCall.args !== null
          ? (toolCall.args as Record<string, unknown>)
          : undefined,
    }));
}

/**
 * 从工具响应消息中提取前端可展示的结果。
 */
function getToolResult(
  message: BaseMessage,
): { id?: string; name: string; content: unknown } | null {
  if (!ToolMessage.isInstance(message)) return null;

  return {
    id: (message as { tool_call_id?: string }).tool_call_id,
    name: message.name ?? "unknown",
    content: message.content,
  };
}
