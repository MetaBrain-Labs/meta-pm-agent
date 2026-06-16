import { AIMessage, HumanMessage } from "langchain";
import type { ChatMessage } from "@repo/shared";
import { createConversationAgent } from "./model";
import {
  getReasoningContent,
  getTextContent,
  toLangChainMessages,
} from "./utils/message-adapter";
import { streamTaggedBlock } from "./utils/tagged-block-stream";
import { isFormAnswer } from "./utils/form-parser";
import type { ConversationStreamEvent, StreamChunk } from "./types";

async function* streamAgentEvents(
  messages: (HumanMessage | AIMessage)[],
): AsyncGenerator<StreamChunk> {
  const agent = createConversationAgent();
  const run = await agent.stream(
    { messages },
    { streamMode: "messages" },
  );

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

export async function* streamQuestionForm(
  userMessage: string,
): AsyncGenerator<StreamChunk> {
  yield* streamAgentEvents([new HumanMessage(userMessage)]);
}

export async function* streamConversation(
  messages: ChatMessage[],
): AsyncGenerator<ConversationStreamEvent> {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    throw new Error("At least one chat message is required.");
  }

  if (lastMessage.role === "user" && isFormAnswer(lastMessage.content)) {
    yield* streamUserInputIntegration(messages);
    return;
  }

  yield* streamTaggedBlock(
    streamAgentEvents(toLangChainMessages(messages)),
    [
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
    ],
  );
}

async function* streamUserInputIntegration(
  messages: ChatMessage[],
): AsyncGenerator<ConversationStreamEvent> {
  let textBuffer = "";
  let started = false;

  for await (const chunk of streamAgentEvents(toLangChainMessages(messages))) {
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
    yield {
      type: "user-input-complete",
      content: ensureUserInputBlock(textBuffer),
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
