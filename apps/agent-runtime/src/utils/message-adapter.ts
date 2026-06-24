/**
 * LangChain 消息适配器
 *
 * 提供 ChatMessage（API 层）与 LangChain BaseMessage（Agent 运行时）之间的
 * 双向转换，以及推理内容、文本内容和 token 用量的提取工具。
 *
 * Responsibilities:
 * - 将 ChatMessage[] 转换为 LangChain HumanMessage / AIMessage
 * - 从 BaseMessage 中提取 reasoning_content 和纯文本 content
 * - 从 AIMessage 中提取 usage_metadata（token 用量）
 */

import { AIMessage, HumanMessage, type BaseMessage } from "langchain";
import type { ChatMessage } from "@repo/shared";

/**
 * token 用量结构，来自 LangChain AIMessage.usage_metadata。
 * 区分缓存命中与未命中的输入 token，用于精确计费。
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 缓存命中的输入 token 数 */
  cacheHitInputTokens: number;
  /** 缓存未命中的输入 token 数 */
  cacheMissInputTokens: number;
}

/**
 * 将 ChatMessage 转换为 LangChain 官方推荐并自带的 HumanMessage 或 AIMessage。
 * 如果 ChatMessage 中包含 reasoningContent，则将其作为 additional_kwargs 的 reasoning_content 属性传递给 AIMessage。
 */
export function toLangChainMessages(
  messages: ChatMessage[],
): Array<HumanMessage | AIMessage> {
  return messages.map((message) => {
    if (message.role === "user") {
      return new HumanMessage(message.content);
    }

    return new AIMessage({
      content: message.content,
      ...(message.reasoningContent
        ? {
            additional_kwargs: {
              reasoning_content: message.reasoningContent,
            },
          }
        : {}),
    });
  });
}

/**
 * 从 message 中获取推理内容
 */
export function getReasoningContent(message: BaseMessage): string {
  const reasoning = message.additional_kwargs?.reasoning_content;
  return typeof reasoning === "string" ? reasoning : "";
}

/**
 * 从 message 中获取文本内容
 */
export function getTextContent(message: BaseMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
}

/**
 * 从 AIMessage 中提取 LLM provider 返回的 token 用量信息。
 * 使用 LangChain usage_metadata 标准字段，兼容 OpenAI/DeepSeek API，
 * 并区分缓存命中/未命中的输入 token。
 */
export function getTokenUsage(message: BaseMessage): TokenUsage | null {
  if (!AIMessage.isInstance(message)) return null;

  const usage = message.usage_metadata as
    | Record<string, unknown>
    | undefined;
  if (!usage || typeof usage.input_tokens !== "number") return null;

  const inputTokens = usage.input_tokens as number;
  const outputTokens = (usage.output_tokens as number) ?? 0;
  const totalTokens =
    (usage.total_tokens as number) ?? inputTokens + outputTokens;

  // 从 input_token_details 中提取缓存命中 token 数，
  // 兼容 DeepSeek 的 cache_read 和 OpenAI 的 cached_tokens 两种键名。
  const inputDetails = usage.input_token_details as
    | Record<string, unknown>
    | undefined;
  const cacheHitInputTokens =
    (inputDetails?.cache_read as number) ??
    (inputDetails?.cached_tokens as number) ??
    0;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheHitInputTokens,
    cacheMissInputTokens: inputTokens - cacheHitInputTokens,
  };
}
