/**
 * Conversation Agent 闲聊回复器
 *
 * 在 Planner Intake Agent 已经判定最新用户消息属于闲聊或非项目问题后，使用一个窄职责的
 * Conversation Agent 回复器生成真正展示给用户的回答，避免 Planner Intake Agent 直接承担闲聊表达。
 *
 * Responsibilities:
 * - 接收 Planner Intake 已放行的闲聊输入
 * - 生成简短、直接、同语言的用户回复
 * - 记录 Conversation Agent 运行摘要和 token 用量
 *
 * Notes:
 * - 本模块不使用 DeepAgents，避免注入通用任务执行提示导致闲聊回复跑偏。
 */

import { HumanMessage, SystemMessage, type BaseMessage } from "langchain";
import { calculateCost } from "../../config";
import { createChatModel } from "../common/model";
import { createAgentRunSummaryRecorder } from "../common/agent-run-summary";
import {
  getTextContent,
  getTokenUsage,
} from "../../utils/message-adapter";
import type { ConversationStreamEvent } from "../../types";
import type { UserInputRecord } from "../request/user-input";

const CONVERSATION_CHITCHAT_PROMPT = `You are the Conversation Agent in a product-management chat workflow.

Planner Intake Agent has classified the latest user turn as chitchat or a non-project question.

Your job:
- Answer the user's casual question directly and briefly.
- Use the same language as the user's latest message.
- Do not mention Planner Intake, Request Agent, workflows, routing, or product requirements.
- Do not ask a product discovery question.
- Do not create a Question Form.
- Do not produce tool calls, task plans, or implementation steps.
- If the question is factual and simple, answer it directly.
- If the question is unsafe or impossible to answer accurately, say so briefly and ask the user to rephrase.`;

export interface ConversationChitchatReplyInput {
  productContext?: string;
  userInput: UserInputRecord[];
  signal?: AbortSignal;
}

/**
 * 生成 Conversation Agent 的闲聊回复，并透传 token 用量事件。
 */
export async function* streamConversationChitchatReply(
  input: ConversationChitchatReplyInput,
): AsyncGenerator<ConversationStreamEvent, string, void> {
  const startTime = Date.now();
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;
  const summaryRecorder = createAgentRunSummaryRecorder({
    agentLabel: "Conversation Agent",
    agentName: "conversation-chitchat-agent",
    agentType: "conversation",
    context: {
      modelOptions: {
        enableThinking: false,
        maxTokens: 512,
        temperature: 0,
      },
      payload: {
        user_input: input.userInput,
      },
      productContext: input.productContext,
      systemPrompt: CONVERSATION_CHITCHAT_PROMPT,
      tools: [],
    },
  });

  try {
    const model = createChatModel({
      enableThinking: false,
      maxTokens: 512,
      temperature: 0,
    });
    const response = (await model.invoke(
      [
        new SystemMessage(CONVERSATION_CHITCHAT_PROMPT),
        new HumanMessage(JSON.stringify({ user_input: input.userInput })),
      ],
      { signal: input.signal },
    )) as BaseMessage;
    const text = normalizeConversationReply(getTextContent(response));
    tokenUsage = getTokenUsage(response);
    summaryRecorder.recordOutput(text);

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

    await summaryRecorder.finish({
      output: text,
      status: text ? "completed" : "fallback",
      tokenUsage: tokenUsage
        ? {
            ...tokenUsage,
            durationMs: Date.now() - startTime,
          }
        : undefined,
    });
    return text || createFallbackConversationReply(input.userInput);
  } catch (error) {
    const fallback = createFallbackConversationReply(input.userInput);
    await summaryRecorder.finish({
      error,
      output: fallback,
      status: "fallback",
    });
    return fallback;
  }
}

/**
 * 清理模型输出，避免空白和代码围栏污染普通闲聊回复。
 */
function normalizeConversationReply(text: string): string {
  return text
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/**
 * 模型不可用时的简短兜底回复。
 */
function createFallbackConversationReply(userInput: UserInputRecord[]): string {
  const text = userInput.map((item) => item.content).join("\n");
  return /[\u4e00-\u9fa5]/.test(text)
    ? "这个问题我暂时没法准确回答，可以换个问法吗？"
    : "I cannot answer that accurately right now. Could you rephrase it?";
}
