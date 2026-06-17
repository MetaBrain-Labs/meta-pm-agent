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
import { runWorkflowGraph } from "../../graph/workflow";
import type {
  ConversationStreamEvent,
  ConversationStreamOptions,
  StreamChunk,
} from "../../types";

/**
 * 流式获取 Conversation Agent 的原始消息事件。
 */
async function* streamAgentEvents(
  messages: (HumanMessage | AIMessage)[],
): AsyncGenerator<StreamChunk> {
  const agent = createConversationAgent();
  const run = await agent.stream({ messages }, { streamMode: "messages" });

  for await (const [message] of run) {
    const reasoning = getReasoningContent(message);
    if (reasoning) {
      yield { type: "reasoning", content: reasoning };
    }

    const text = getTextContent(message);
    const cleanText = stripInternalNoise(text);
    if (cleanText) {
      yield { type: "text", content: cleanText };
    }
  }
}

/**
 * 专门处理 Question Form 生成阶段的流式输出。
 */
export async function* streamQuestionForm(
  userMessage: string,
): AsyncGenerator<StreamChunk> {
  yield* streamAgentEvents([new HumanMessage(userMessage)]);
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
    // TODO 这部分的推理可能需要再页面展示，考虑使用一个通用的方法接收所有Agent的推理过程
    if (chunk.type === "reasoning") {
      yield chunk;
      continue;
    }

    textBuffer += chunk.content;
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
    yield { type: "request-analysis-start" };
    const result = await runWorkflowGraph({
      productContext: options.productContext,
      userInputBlock,
    });
    yield {
      type: "request-analysis-complete",
      content: result.requestAnalysisBlock,
      analysis: result.requestAnalysis,
    };
  }
}

function ensureUserInputBlock(content: string): string {
  const trimmed = content.trim();
  if (/^<user-input\b/i.test(trimmed)) {
    return trimmed;
  }

  return `<user-input>\n${trimmed}\n</user-input>`;
}

function stripInternalNoise(content: string): string {
  return content
    .replace(/(^|\n)No files found in\s+\/\s*/g, "$1")
    .replace(/(^|\n)No files found in\s+\.\s*/g, "$1");
}
