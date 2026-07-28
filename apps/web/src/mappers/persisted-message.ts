/**
 * 历史消息恢复映射器
 *
 * 将 API 返回的持久化消息转换为聊天组件消费的前端消息模型，
 * 使刷新后的展示与实时流式展示保持一致。
 *
 * Responsibilities:
 * - 恢复正文、推理、工具调用和结构化业务卡片
 * - 将持久化 token 用量挂回对应消息
 * - 兼容不同 Agent 类型的展示位置
 *
 * Notes:
 * - 本文件不负责请求 API，只处理 DTO 到视图模型的转换。
 */

import type { Message, PersistedMessageInfo } from "../types";

/**
 * 将后端持久化消息恢复成前端流式渲染组件可直接消费的消息结构。
 */
export function mapPersistedMessageToMessage(
  message: PersistedMessageInfo,
): Message {
  const workflowCompletion =
    message.type === "conversation_confirmation" &&
    message.content.includes("本轮产品工作流已正式结束")
      ? {
          state: "complete" as const,
          content: message.content,
        }
      : undefined;
  return {
    id: message.id,
    role: message.role === "assistant" ? "agent" : "user",
    type: message.type,
    content: workflowCompletion ? "" : message.content,
    timestamp: new Date(message.timestamp).getTime(),
    ...(message.reasoningContent &&
    message.type &&
    message.type !== "conversation"
      ? {
          reasoningBlocks: [
            {
              agentType: message.type,
              content: message.reasoningContent,
            },
          ],
        }
      : {}),
    ...(message.reasoningContent &&
    (!message.type || message.type === "conversation")
      ? { thinking: message.reasoningContent }
      : {}),
    ...(message.toolCalls && message.toolCalls.length > 0
      ? {
          toolCalls: message.toolCalls.map((toolCall) => ({
            ...toolCall,
            agentType: toolCall.agentType ?? message.type ?? undefined,
          })),
        }
      : {}),
    ...(message.subagentTraces && message.subagentTraces.length > 0
      ? {
          subagentTraces: message.subagentTraces.map((trace) => ({
            ...trace,
            parentAgentType: trace.parentAgentType ?? message.type ?? undefined,
          })),
        }
      : {}),
    ...(message.agentError ? { agentError: message.agentError } : {}),
    ...(workflowCompletion ? { workflowCompletion } : {}),
    ...(message.userInput
      ? {
          userInput: {
            state: "complete" as const,
            content: JSON.stringify(
              { user_input: message.userInput },
              null,
              2,
            ),
          },
        }
      : {}),
    // 历史消息从 API 返回结构化结果后，恢复成和流式事件一致的卡片状态。
    ...(message.requestAnalysis
      ? {
          requestAnalysis: {
            state: "complete" as const,
            content: JSON.stringify(message.requestAnalysis, null, 2),
            analysis: message.requestAnalysis,
          },
        }
      : {}),
    ...(message.taskExecutionPlan
      ? {
          plannerExecution: {
            state: "complete" as const,
            content: JSON.stringify(message.taskExecutionPlan, null, 2),
            plan: message.taskExecutionPlan,
          },
        }
      : {}),
    ...(message.productWorkflow
      ? {
          executorResults: message.productWorkflow.executor_results,
          plannerReview: {
            state: "complete" as const,
            result: message.productWorkflow,
          },
        }
      : {}),
    ...(message.executorResults && message.executorResults.length > 0
      ? { executorResults: message.executorResults }
      : {}),
    ...(message.executorResult
      ? { executorResults: [message.executorResult] }
      : {}),
    ...(message.tokenUsages && message.tokenUsages.length > 0
      ? { tokenUsages: message.tokenUsages }
      : {}),
  };
}
