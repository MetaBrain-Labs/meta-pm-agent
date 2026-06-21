import { HumanMessage } from "langchain";
import { createDeepAgent } from "deepagents";
import { RequestAnalysisSchema, type RequestAnalysis } from "@repo/shared";
import { createChatModel } from "../common/model";
import { REQUEST_AGENT_PROMPT } from "./prompt";
import {
  getReasoningContent,
  getTextContent,
} from "../../utils/message-adapter";
import { parseJsonObject } from "../../utils/json";
import type { UserInputRecord } from "./user-input";

const REQUEST_AGENT_MAX_ATTEMPTS = 2;

export interface RequestAgentInput {
  productContext?: string;
  userInput: UserInputRecord[];
  signal?: AbortSignal;
}

/**
 * Request Agent 流式输出，用于把推理过程和最终分析结果分开传递给上层。
 */
export type RequestAgentStreamEvent =
  | { type: "reasoning"; content: string; agentType: "request" }
  | { type: "complete"; analysis: RequestAnalysis };

/**
 * 创建真正的 Request Agent，由 DeepAgent 承载 system prompt 和模型调用。
 */
export function createRequestAgent() {
  const model = createChatModel({
    enableThinking: false,
    maxTokens: 4096,
    responseFormat: "json_object",
    temperature: 0,
  });
  return createDeepAgent({
    model: model as any,
    systemPrompt: REQUEST_AGENT_PROMPT,
    tools: [],
    name: "request-agent",
    skills: [],
  });
}

export async function runRequestAgent(
  input: RequestAgentInput,
): Promise<RequestAnalysis> {
  let analysis: RequestAnalysis | null = null;

  // 复用流式实现，保证图节点和 SSE 路径使用同一套 Request Agent 解析逻辑。
  for await (const event of streamRequestAgent(input)) {
    if (event.type === "complete") {
      analysis = event.analysis;
    }
  }

  if (!analysis) {
    throw new Error("Request Agent did not produce a request analysis.");
  }

  return analysis;
}

/**
 * 流式执行 Request Agent，实时暴露推理过程，并在结束时返回结构化分析结果。
 */
export async function* streamRequestAgent(
  input: RequestAgentInput,
): AsyncGenerator<RequestAgentStreamEvent> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= REQUEST_AGENT_MAX_ATTEMPTS; attempt++) {
    const agent = createRequestAgent();

    // Request Agent 不直接和用户交互，只读取 Conversation Agent 整理出的
    // user_input 记录以及可选的产品上下文。
    const run = await agent.stream(
      {
        messages: [
          new HumanMessage(
            JSON.stringify({
              product_context:
                input.productContext?.trim() || "No product context provided.",
              user_input: input.userInput,
              ...(attempt > 1
                ? {
                    retry_instruction:
                      "The previous response failed schema validation. Return only one valid JSON object that matches RequestAnalysisSchema exactly.",
                  }
                : {}),
            }),
          ),
        ],
      },
      { streamMode: "messages", signal: input.signal },
    );

    let responseText = "";
    for await (const [message] of run) {
      const reasoning = getReasoningContent(message);
      if (reasoning) {
        yield { type: "reasoning", content: reasoning, agentType: "request" };
      }

      responseText += getTextContent(message);
    }

    try {
      // LLM 输出必须先通过结构校验，避免下游图节点和 API 处理不符合约定的数据。
      const parsed = parseJsonObject(responseText);
      const result = RequestAnalysisSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(
          "Request Agent did not produce a valid request analysis payload.",
        );
      }

      assertEveryUserInputCovered(result.data, input.userInput);
      yield { type: "complete", analysis: result.data };
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < REQUEST_AGENT_MAX_ATTEMPTS) {
        yield {
          type: "reasoning",
          content:
            "\nRequest Agent 输出结构校验失败，正在自动重试一次。\n",
          agentType: "request",
        };
      }
    }
  }

  throw lastError ?? new Error("Request Agent did not produce a request analysis.");
}

/**
 * 格式化 Request Analysis 块
 */
export function formatRequestAnalysisBlock(analysis: RequestAnalysis): string {
  // 保留可解析的结构化 JSON。
  return `<request-analysis>\n${JSON.stringify(analysis, null, 2)}\n</request-analysis>`;
}

/**
 * 验证 Request Agent 的分析结果是否合理覆盖了输入的 user_input 记录：
 * - 没有遗漏：每条 user_input 都被 request agent 以某种方式覆盖了（业务模型、问答、闲聊至少一种）。
 * - 没有重复：每条 user_input 在 request agent 的分析结果中只被覆盖了一次，避免出现分类不清或过度覆盖。
 * - 没有越界：request agent 的分析结果中没有覆盖任何不存在的 user_input 记录（比如 index 超出范围）。
 */
function assertEveryUserInputCovered(
  analysis: RequestAnalysis,
  userInput: UserInputRecord[],
): void {
  const expected = new Set(userInput.map((item) => item.index));
  const covered = new Map<number, number>();

  for (const item of analysis.business_model) {
    for (const index of item.covered_user_input_indexes) {
      covered.set(index, (covered.get(index) ?? 0) + 1);
    }
  }
  for (const index of analysis.questions) {
    covered.set(index, (covered.get(index) ?? 0) + 1);
  }
  for (const index of analysis.chitchat) {
    covered.set(index, (covered.get(index) ?? 0) + 1);
  }

  const invalid = [...covered.keys()].filter((index) => !expected.has(index));
  const missing = [...expected].filter((index) => !covered.has(index));
  const duplicates = [...covered.entries()]
    .filter(([, count]) => count > 1)
    .map(([index]) => index);

  if (invalid.length > 0 || missing.length > 0 || duplicates.length > 0) {
    throw new Error(
      "Request Agent coverage is invalid: " +
        JSON.stringify({ invalid, missing, duplicates }),
    );
  }
}
