import { AIMessage, HumanMessage } from "langchain";
import type { ChatMessage } from "@repo/shared";
import { createConversationAgent } from "./agent";
import {
  getReasoningContent,
  getTextContent,
  toLangChainMessages,
} from "../../utils/message-adapter";
import { streamTaggedBlock } from "../../utils/tagged-block-stream";
import { isFormAnswer } from "../../utils/form-parser";
import {
  formatRequestAnalysisBlock,
  streamRequestAgent,
} from "../request/agent";
import { parseUserInputBlock } from "../request/user-input";
import type {
  ConversationStreamEvent,
  ConversationStreamOptions,
  StreamChunk,
} from "../../types";

/**
 * 流式获取 Conversation Agent 的原始消息事件。
 *  注：此处拼接最底层的文本内容，yield { type: "reasoning/text", content: reasoning };
 *        后续如果遇到需要标签块的场景，重新封装并抛出，例如：yield { type: "question-form-start" }
 *        否则可以直接使用 yield chunk 的形式抛出原始内容，而无需再次封装
 */
async function* streamAgentEvents(
  messages: (HumanMessage | AIMessage)[],
): AsyncGenerator<StreamChunk> {
  const agent = createConversationAgent();
  const run = await agent.stream({ messages }, { streamMode: "messages" });

  for await (const [message] of run) {
    const reasoning = getReasoningContent(message);
    if (reasoning) {
      yield {
        type: "reasoning",
        content: reasoning,
        agentType: "conversation",
      };
    }

    const text = getTextContent(message);
    const cleanText = stripInternalNoise(text);
    if (cleanText) {
      yield { type: "text", content: cleanText, agentType: "conversation" };
    }
  }
}

/**
 * 处理完整会话流，并在表单答案整合后接入 Request Agent。
 */
export async function* streamConversation(
  messages: ChatMessage[],
  options: ConversationStreamOptions = {},
): AsyncGenerator<ConversationStreamEvent> {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    throw new Error("At least one chat message is required.");
  }

  if (lastMessage.role === "user" && isFormAnswer(lastMessage.content)) {
    yield* streamUserInputIntegration(messages, options);
    return;
  }

  yield* streamTaggedBlock(streamAgentEvents(toLangChainMessages(messages)), [
    {
      startMarker: "<question-form",
      endMarker: "</question-form>",
      startEvent: "question-form-start",
      completeEvent: "question-form-complete",
    },
    {
      startMarker: "<user-input",
      endMarker: "</user-input>",
      startEvent: "user-input-start",
      completeEvent: "user-input-complete",
    },
  ]);
}

async function* streamUserInputIntegration(
  messages: ChatMessage[],
  options: ConversationStreamOptions,
): AsyncGenerator<ConversationStreamEvent> {
  let textBuffer = "";
  let started = false;

  for await (const chunk of streamAgentEvents(toLangChainMessages(messages))) {
    if (chunk.type === "reasoning") {
      yield chunk;
      continue;
    }

    // 保存非推理内容。
    textBuffer += chunk.content;
    // 第一次收到非推理内容时，触发 user-input-start 事件，表示用户输入的整理开始。
    if (!started) {
      started = true;
      yield { type: "user-input-start" };
    }
  }

  if (started) {
    const userInputBlock = ensureUserInputBlock(textBuffer);
    yield {
      type: "user-input-complete",
      content: userInputBlock,
    };

    // 表单答案被整理成 user_input 后，立即进入无需用户参与的 Request Agent 处理。
    const userInput = parseUserInputBlock(userInputBlock);

    // Request Agent 的推理过程需要出现在用户输入整理之后、分析结果之前。
    yield { type: "request-analysis-start", agentType: "request" };
    for await (const event of streamRequestAgent({
      productContext: options.productContext,
      userInput,
    })) {
      if (event.type === "reasoning") {
        yield event;
        continue;
      }

      yield {
        type: "request-analysis-complete",
        content: formatRequestAnalysisBlock(event.analysis),
        analysis: event.analysis,
        agentType: "request",
      };
    }
  }
}

/**
 * 格式化为 <user-input> 块，如果已经是该块则直接返回。
 */
function ensureUserInputBlock(content: string): string {
  const trimmed = content.trim();
  if (/^<user-input\b/i.test(trimmed)) {
    return trimmed;
  }

  return `<user-input>\n${trimmed}\n</user-input>`;
}

/**
 * 剪切内部噪声
 */
function stripInternalNoise(content: string): string {
  return content
    .replace(/(^|\n)No files found in\s+\/\s*/g, "$1")
    .replace(/(^|\n)No files found in\s+\.\s*/g, "$1");
}
