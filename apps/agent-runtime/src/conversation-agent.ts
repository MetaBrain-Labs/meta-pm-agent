import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage, type BaseMessage } from "langchain";
import { ChatMessage } from "@repo/shared";
import { DISCOVERY_PROMPT } from "./prompts/discovery";
import { COMPRESS_PROMPT } from "./prompts/compress";
import { createDeepAgent } from "deepagents";

dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  ),
});

// 交流结果
export interface ConversationResult {
  action: "question_form" | "summarize" | "respond";
  content: string;
  compressedContext?: string;
}

// 对话流切片
export interface StreamChunk {
  type: "reasoning" | "text";
  content: string;
}

// Conversation Agent的SYSTEM_PROMPT
const SYSTEM_PROMPT = `${DISCOVERY_PROMPT}`;

/**
 * LLM 基础配置
 */
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
    temperature: 0.3,
    maxTokens: 2048,
    timeout: 30000,
    configuration: { baseURL },
    modelKwargs: Object.keys(modelKwargs).length > 0 ? modelKwargs : undefined,
  });
}

/**
 * 创建Agent
 */
function createAgent() {
  return createDeepAgent({
    model: getLLM() as any,
    systemPrompt: SYSTEM_PROMPT,
    tools: [],
    name: "conversation-agent",
    skills: [],
  });
}

/**
 * 将用户输入转换为LangChain接受输入
 */
function toLangChainMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "user") return new HumanMessage(m.content);
    return new AIMessage({
      content: m.content,
      ...(m.reasoningContent
        ? { additional_kwargs: { reasoning_content: m.reasoningContent } }
        : {}),
    });
  });
}

/**
 * 异步生成器函数：用于流式输出 AI Agent 的响应内容
 */
async function* streamAgentEvents(
  messages: (HumanMessage | AIMessage)[],
): AsyncGenerator<StreamChunk> {
  const agent = createAgent();
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

function getReasoningContent(message: BaseMessage): string {
  const reasoning = message.additional_kwargs?.reasoning_content;
  return typeof reasoning === "string" ? reasoning : "";
}

function getTextContent(message: BaseMessage): string {
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
 * 异步生成器函数：用于封装QuestionForm消息流并委托给另一个异步生成器 —— streamAgentEvents
 */
export async function* streamQuestionForm(
  userMessage: string,
): AsyncGenerator<StreamChunk> {
  yield* streamAgentEvents([new HumanMessage(userMessage)]);
}

/**
 * 异步生成器函数：用于封装Compress消息流并委托给另一个异步生成器 —— streamAgentEvents
 */
export async function* streamCompressConversation(
  messages: ChatMessage[],
): AsyncGenerator<StreamChunk> {
  yield* streamAgentEvents([
    new HumanMessage(COMPRESS_PROMPT),
    ...toLangChainMessages(messages),
  ]);
}
