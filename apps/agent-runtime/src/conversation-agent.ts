import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { ChatOpenAI } from "@langchain/openai";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";
import { ChatMessage } from "@repo/shared";
import { isFormAnswer, parseFormAnswers } from "./utils/form-parser";
import { DISCOVERY_PROMPT } from "./prompts/discovery";
import { COMPRESS_PROMPT } from "./prompts/compress";
import { DISCOVERY } from "./prompts/discovery.origin";

dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  ),
});

export interface ConversationResult {
  action: "question_form" | "summarize" | "respond";
  content: string;
  compressedContext?: string;
}

export interface StreamChunk {
  type: "reasoning" | "text";
  content: string;
}

function toLangChainMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "user") return new HumanMessage(m.content);
    return new AIMessage({
      content: m.content,
      additional_kwargs: m.reasoningContent
        ? { reasoning_content: m.reasoningContent }
        : {},
    });
  });
}

function getLLM() {
  const model = process.env.LLM_MODEL ?? "deepseek-chat";
  const baseURL = process.env.LLM_BASE_URL ?? "https://api.deepseek.com";
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Please add it to your .env file.",
    );
  }

  const modelKwargs: Record<string, unknown> = {};

  if (process.env.LLM_ENABLE_THINKING === "true") {
    modelKwargs.thinking = { type: "enabled" };
    modelKwargs.reasoning_effort = process.env.LLM_REASONING_EFFORT ?? "high";
  }

  return new ChatOpenAI({
    model,
    apiKey,
    streaming: true,
    temperature: 0.3,
    maxTokens: 2048,
    timeout: 30000,
    configuration: { baseURL },
    modelKwargs: Object.keys(modelKwargs).length > 0 ? modelKwargs : undefined,
    __includeRawResponse: true,
  });
}

export async function generateQuestionForm(
  userMessage: string,
): Promise<string> {
  const llm = getLLM();
  const messages = [
    new SystemMessage(DISCOVERY),
    new HumanMessage(userMessage),
  ];

  const response = await llm.invoke(messages);
  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}

export async function* streamQuestionForm(
  userMessage: string,
): AsyncGenerator<StreamChunk> {
  const llm = getLLM();
  const messages = [
    new SystemMessage(DISCOVERY_PROMPT),
    new HumanMessage(userMessage),
  ];

  const stream = await llm.stream(messages);

  for await (const chunk of stream) {
    const rawResponse = (
      chunk.additional_kwargs as Record<string, unknown> | undefined
    )?.__raw_response as Record<string, unknown> | undefined;
    const rawDelta = (
      (rawResponse as Record<string, unknown> | undefined)?.choices as
        | Record<string, unknown>[]
        | undefined
    )?.[0]?.delta as Record<string, unknown> | undefined;
    const reasoning = rawDelta?.reasoning_content;

    if (typeof reasoning === "string" && reasoning.length > 0) {
      yield { type: "reasoning", content: reasoning };
    }

    const text = chunk.content;
    if (typeof text === "string" && text.length > 0) {
      yield { type: "text", content: text };
    }
  }
}

export async function compressConversation(
  messages: ChatMessage[],
): Promise<string> {
  const llm = getLLM();

  const langChainMessages = [
    new SystemMessage(COMPRESS_PROMPT),
    ...toLangChainMessages(messages),
  ];

  const response = await llm.invoke(langChainMessages);
  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}

export function extractCompressedContext(text: string): string | undefined {
  const match = text.match(/\[COMPRESSED\]([\s\S]*?)\[\/COMPRESSED\]/);
  return match ? match[1].trim() : undefined;
}

export async function analyzeConversation(
  messages: ChatMessage[],
): Promise<ConversationResult> {
  const lastMsg = messages.at(-1);
  if (!lastMsg) {
    return { action: "respond", content: "No message provided." };
  }

  if (lastMsg.role === "user" && isFormAnswer(lastMsg.content)) {
    const compressed = await compressConversation(messages);
    return {
      action: "summarize",
      content: compressed,
      compressedContext: extractCompressedContext(compressed),
    };
  }

  const questionForm = await generateQuestionForm(lastMsg.content);

  return {
    action: "question_form",
    content: questionForm,
  };
}
