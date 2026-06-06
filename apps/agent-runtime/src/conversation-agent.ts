import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { ChatMessage } from "@repo/shared";

dotenv.config({
  path: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  ),
});

export interface ConversationResult {
  action: "ask" | "summarize";
  question?: string;
  summary?: string;
}

const SYSTEM_PROMPT = `You are a project management requirement-gathering agent. Your job is to thoroughly understand what the user wants before passing to downstream agents (planner, estimator).

For each user request, identify what information is MISSING or AMBIGUOUS. Ask ONE clear, focused question at a time to fill the gaps. Important areas to probe:
- Core goal / problem being solved
- Target users and their workflow
- Must-have vs nice-to-have features
- Technical constraints or preferences (platform, tech stack, integrations)
- Timeline expectations
- Team size and composition
- Success criteria

Only when the conversation has covered enough ground to form a clear, actionable understanding should you stop asking questions.

OUTPUT FORMAT — You MUST respond with exactly one of these two formats:

If more information is needed:
  {"action": "ask", "question": "<your single follow-up question>"}

If you have enough information:
  {"action": "summarize", "summary": "<compressed summary covering: goal, key requirements, constraints, assumptions>"}

Rules:
- NEVER output anything other than the JSON above.
- Ask only ONE question per response.
- Be concise in your question — one or two sentences.
- The summary should be self-contained and actionable for downstream agents.
- If the initial message is very vague (e.g. just "help me"), ask what they want to build.`;

/**
 * 将用户消息封装为LangChain可以识别的消息
 */
function toLangChainMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "user") return new HumanMessage(m.content);
    return new AIMessage(m.content);
  });
}

/**
 * 调用 LLM 解析对话
 */
export async function analyzeConversation(
  messages: ChatMessage[],
): Promise<ConversationResult> {
  const model = process.env.LLM_MODEL ?? "deepseek-chat";
  const baseURL = process.env.LLM_BASE_URL ?? "https://api.deepseek.com";

  const llm = new ChatOpenAI({
    model,
    temperature: 0.3,
    maxTokens: 1024,
    configuration: { baseURL },
  });

  const langChainMessages = [
    new SystemMessage(SYSTEM_PROMPT),
    ...toLangChainMessages(messages),
  ];

  const response = await llm.invoke(langChainMessages);
  const raw =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  try {
    const parsed = JSON.parse(raw.trim()) as ConversationResult;

    if (parsed.action === "ask" && parsed.question) {
      return { action: "ask", question: parsed.question };
    }

    if (parsed.action === "summarize" && parsed.summary) {
      return { action: "summarize", summary: parsed.summary };
    }

    return { action: "summarize", summary: raw.trim() };
  } catch {
    return { action: "summarize", summary: raw.trim() };
  }
}
