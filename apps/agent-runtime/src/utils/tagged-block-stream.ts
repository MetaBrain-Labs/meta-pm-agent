/**
 * 标记块流式处理
 *
 * 将 Conversation Agent 原始文本流按标记块（如 <question-form>...</question-form>、
 * <user-input>...</user-input>）分段，分别转换为 question-form-start/complete、
 * user-input-start/complete 事件，标记块之外的文本按原样透传。
 *
 * Responsibilities:
 * - 从 AsyncIterable<ConversationStreamEvent> 中检测并收集标记块
 * - 按标记块生命周期发出 start/complete 事件
 * - 保持标记块外文本和 reasoning 事件的流式顺序
 *
 * Notes:
 * - 支持同时监听多个标记块类型
 */

import type { AgentMessageType, ConversationStreamEvent } from "../types";

interface TaggedBlockOptions {
  startMarker: string;
  endMarker: string;
  startEvent: "question-form-start" | "user-input-start" | "workflow-resume-start";
  completeEvent:
    | "question-form-complete"
    | "user-input-complete"
    | "workflow-resume-complete";
}

/**
 * 处理 Conversation Agent 相关标记块（Question Form 标记块/ User Input 标记块）
 */
export async function* streamTaggedBlock(
  source: AsyncIterable<ConversationStreamEvent>,
  options: TaggedBlockOptions | TaggedBlockOptions[],
): AsyncGenerator<ConversationStreamEvent> {
  const tagOptions = Array.isArray(options) ? options : [options];
  let blockBuffer = "";
  let pendingText = "";
  let pendingTextAgentType: AgentMessageType | undefined;
  let blockAgentType: AgentMessageType | undefined;
  let collecting = false;
  let activeOptions: TaggedBlockOptions | null = null;

  for await (const chunk of source) {
    if (chunk.type === "reasoning") {
      yield chunk;
      continue;
    }
    if (chunk.type !== "text") {
      yield chunk;
      continue;
    }

    // 根据当前是否正在收集标记块内容，决定将 chunk 内容添加到 blockBuffer 或 pendingText 中
    if (collecting) {
      blockBuffer += chunk.content;
      blockAgentType ??= chunk.agentType;
    } else {
      pendingText += chunk.content;
      pendingTextAgentType ??= chunk.agentType;
    }

    while (true) {
      // 如果正在收集标记块内容，检查是否找到了结束标记，如果找到了，则触发 completeEvent 并重置状态
      if (collecting) {
        if (!activeOptions) {
          throw new Error("Tagged block collector missing active options.");
        }

        const endIndex = blockBuffer.indexOf(activeOptions.endMarker);
        if (endIndex === -1) {
          break;
        }

        const blockEnd = endIndex + activeOptions.endMarker.length;
        const content = blockBuffer.slice(0, blockEnd);
        pendingText = blockBuffer.slice(blockEnd);
        pendingTextAgentType = blockAgentType;
        blockBuffer = "";
        blockAgentType = undefined;
        collecting = false;

        yield { type: activeOptions.completeEvent, content };
        activeOptions = null;
        continue;
      }

      const match = findFirstMarker(pendingText, tagOptions);
      // 如果找到了标记块的起始位置，处理标记块前的文本并开始收集标记块内容
      if (match) {
        const textBeforeBlock = pendingText.slice(0, match.startIndex);
        if (textBeforeBlock) {
          yield createTextEvent(textBeforeBlock, pendingTextAgentType);
        }

        blockBuffer = pendingText.slice(match.startIndex);
        blockAgentType = pendingTextAgentType ?? chunk.agentType;
        pendingText = "";
        pendingTextAgentType = undefined;
        collecting = true;
        activeOptions = match.options;
        yield { type: match.options.startEvent };
        continue;
      }

      if (!couldEndWithAnyMarkerPrefix(pendingText, tagOptions)) {
        if (pendingText) {
          yield createTextEvent(pendingText, pendingTextAgentType);
          pendingText = "";
          pendingTextAgentType = undefined;
        }
      }
      break;
    }
  }

  if (collecting && blockBuffer) {
    yield createTextEvent(blockBuffer, blockAgentType);
  }
  if (pendingText) {
    yield createTextEvent(pendingText, pendingTextAgentType);
  }
}

/**
 * 只在存在归属 Agent 时写入 agentType，避免测试和持久化层收到 undefined 字段。
 */
function createTextEvent(
  content: string,
  agentType: AgentMessageType | undefined,
): ConversationStreamEvent {
  return agentType
    ? { type: "text", content, agentType }
    : { type: "text", content };
}

/**
 * 检查文本是否可能以标记块的起始标记的前缀结尾
 */
function couldEndWithMarkerPrefix(text: string, marker: string): boolean {
  const maxPrefixLength = Math.min(text.length, marker.length - 1);
  for (let length = maxPrefixLength; length > 0; length -= 1) {
    if (text.endsWith(marker.slice(0, length))) {
      return true;
    }
  }
  return false;
}

/**
 * 要求每个标记块的起始标记都必须能够被识别且能以起始标记结尾。
 */
function couldEndWithAnyMarkerPrefix(
  text: string,
  options: TaggedBlockOptions[],
): boolean {
  return options.some((option) =>
    couldEndWithMarkerPrefix(text, option.startMarker),
  );
}

/**
 * 获取第一个标记块的起始位置和对应的选项
 */
function findFirstMarker(
  text: string,
  options: TaggedBlockOptions[],
): { startIndex: number; options: TaggedBlockOptions } | null {
  let first: { startIndex: number; options: TaggedBlockOptions } | null = null;

  for (const option of options) {
    const startIndex = text.indexOf(option.startMarker);
    if (startIndex === -1) continue;
    if (!first || startIndex < first.startIndex) {
      first = { startIndex, options: option };
    }
  }

  return first;
}
