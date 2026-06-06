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

function toLangChainMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "user") return new HumanMessage(m.content);
    return new AIMessage(m.content);
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

  return new ChatOpenAI({
    model,
    apiKey,
    temperature: 0.3,
    maxTokens: 2048,
    timeout: 30000,
    configuration: { baseURL },
  });
}

export async function generateQuestionForm(
  userMessage: string,
): Promise<string> {
  const llm = getLLM();
  const messages = [
    new SystemMessage(DISCOVERY_PROMPT),
    new HumanMessage(userMessage),
  ];

  const response = await llm.invoke(messages);
  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}

export async function* streamQuestionForm(
  userMessage: string,
): AsyncGenerator<string> {
  const model = process.env.LLM_MODEL ?? "deepseek-chat";
  const baseURL = process.env.LLM_BASE_URL ?? "https://api.deepseek.com";
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Please add it to your .env file.",
    );
  }

  const url = `${baseURL.replace(/\/+$/, "")}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: DISCOVERY_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 2048,
      stream: true,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${err}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // skip malformed lines
      }
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
