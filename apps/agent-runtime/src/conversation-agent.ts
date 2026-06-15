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
import { COMPRESS_PROMPT } from "./prompts/compress";
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
    if (text) {
      yield { type: "text", content: text };
    }
  }
}

export async function* streamQuestionForm(
  userMessage: string,
): AsyncGenerator<StreamChunk> {
  yield* streamAgentEvents([new HumanMessage(userMessage)]);
}

export async function* streamCompressConversation(
  messages: ChatMessage[],
): AsyncGenerator<StreamChunk> {
  yield* streamAgentEvents([
    new HumanMessage(COMPRESS_PROMPT),
    ...toLangChainMessages(messages),
  ]);
}

export async function* streamConversation(
  messages: ChatMessage[],
): AsyncGenerator<ConversationStreamEvent> {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    throw new Error("At least one chat message is required.");
  }

  if (
    lastMessage.role === "user" &&
    isFormAnswer(lastMessage.content)
  ) {
    yield* streamTaggedBlock(
      streamCompressConversation(messages),
      {
        startMarker: "<compress",
        endMarker: "</compress>",
        startEvent: "compress-start",
        completeEvent: "compress-complete",
      },
    );
    return;
  }

  yield* streamTaggedBlock(
    streamQuestionForm(lastMessage.content),
    {
      startMarker: "<question-form",
      endMarker: "</question-form>",
      startEvent: "question-form-start",
      completeEvent: "question-form-complete",
    },
  );
}
