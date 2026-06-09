import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "langchain";
import { ChatMessage } from "@repo/shared";
import { isFormAnswer, parseFormAnswers } from "./utils/form-parser";
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
const SYSTEM_PROMPT = `${DISCOVERY_PROMPT}

---

${COMPRESS_PROMPT}`;

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
  const run = await agent.streamEvents(
    { messages },
    { version: "v3" as const },
  );

  for await (const msg of run.messages) {
    for await (const event of msg) {
      if (event.event === "content-block-delta") {
        if (event.delta.type === "text-delta") {
          yield { type: "text", content: event.delta.text };
        } else if (event.delta.type === "reasoning-delta") {
          yield { type: "reasoning", content: event.delta.reasoning };
        }
      }
    }
  }
}

/**
 * 根据用户的输入生成QuestionForm
 */
export async function generateQuestionForm(
  userMessage: string,
): Promise<string> {
  const agent = createAgent();
  const result = await agent.invoke({
    messages: [new HumanMessage(userMessage)],
  });

  const lastMsg = result.messages?.at(-1);
  if (lastMsg && lastMsg._getType && lastMsg._getType() === "ai") {
    return typeof lastMsg.content === "string"
      ? lastMsg.content
      : JSON.stringify(lastMsg.content);
  }
  return "";
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
 * 请求 Agent 根据上下文进行会话压缩
 */
export async function compressConversation(
  messages: ChatMessage[],
): Promise<string> {
  const agent = createAgent();
  const result = await agent.invoke({
    messages: toLangChainMessages(messages),
  });

  const lastMsg = result.messages?.at(-1);
  if (lastMsg && lastMsg._getType && lastMsg._getType() === "ai") {
    return typeof lastMsg.content === "string"
      ? lastMsg.content
      : JSON.stringify(lastMsg.content);
  }
  return "";
}

/**
 * 仅提取压缩标签中的内容
 */
export function extractCompressedContext(text: string): string | undefined {
  const match = text.match(/\[COMPRESSED\]([\s\S]*?)\[\/COMPRESSED\]/);
  return match ? match[1].trim() : undefined;
}

/**
 * 异步生成器函数：用于封装Compress消息流并委托给另一个异步生成器 —— streamAgentEvents
 */
export async function* streamCompressConversation(
  messages: ChatMessage[],
): AsyncGenerator<StreamChunk> {
  yield* streamAgentEvents(toLangChainMessages(messages));
}

/**
 * 异步生成器函数：用于封装Response消息流并委托给另一个异步生成器 —— streamAgentEvents
 */
export async function* streamAgentResponse(
  compressedContext: string,
  messages: ChatMessage[],
): AsyncGenerator<StreamChunk> {
  yield* streamAgentEvents([
    new HumanMessage(
      `Compressed context:\n<context>\n${compressedContext}\n</context>\n\nBased on the compressed context above, respond to the user.`,
    ),
    ...toLangChainMessages(messages),
  ]);
}

/**
 * 对用户输入进行分析，检测用户输入是否为表单答案提交。
 *   - 是，则进行压缩会话流程
 *   - 不是，则进行QuestionForm生成流程
 *   - 目前限制的太死了，后续改进
 */
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
