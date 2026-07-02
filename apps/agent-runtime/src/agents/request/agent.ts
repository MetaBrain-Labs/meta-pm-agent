/**
 * Request Agent 实现
 *
 * 负责对 Conversation Agent 输出的 user_input 进行业务分类，
 * 将每条独立语句归类为 business_model、questions 或 chitchat。
 * 基于 DeepAgent + JSON 输出模式，支持流式推理和结构化分析。
 *
 * Responsibilities:
 * - 创建并配置 Request Agent DeepAgent 实例
 * - 提供 streamRequestAgent() 流式分析入口
 * - 提供 runRequestAgent() 同步分析入口（含重试）
 * - 格式化 Request Agent 分析结果为展示 block
 *
 * Notes:
 * - 最多重试 2 次，失败时通过 markdown text 事件输出错误信息
 */

import { HumanMessage, type BaseMessage } from "langchain";
import { createDeepAgent } from "deepagents";
import { RequestAnalysisSchema, type RequestAnalysis } from "@repo/shared";
import { createChatModel } from "../common/model";
import { createDefaultAgentMiddleware } from "../common/middleware";
import { calculateCost } from "../../config";
import { REQUEST_AGENT_PROMPT } from "./prompt";
import {
  createAgentRunSummaryMiddleware,
  createAgentRunSummaryRecorder,
  type AgentRunSummaryRecorder,
} from "../common/agent-run-summary";
import {
  getReasoningContent,
  getTextContent,
  getTokenUsage,
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
  | { type: "complete"; analysis: RequestAnalysis }
  | {
      type: "token-usage";
      agentType: "request";
      inputTokens: number;
      cacheHitInputTokens: number;
      cacheMissInputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costInput: number;
      costOutput: number;
      costTotal: number;
      durationMs: number;
    };

/**
 * 创建真正的 Request Agent，由 DeepAgent 承载 system prompt 和模型调用。
 */
export function createRequestAgent(summaryRecorder?: AgentRunSummaryRecorder) {
  const model = createChatModel({
    enableThinking: false,
    maxTokens: 5120,
    responseFormat: "json_object",
    temperature: 0,
  });
  return createDeepAgent({
    model: model as any,
    systemPrompt: REQUEST_AGENT_PROMPT,
    tools: [],
    name: "request-agent",
    skills: [],
    middleware: [
      ...createDefaultAgentMiddleware(),
      ...createAgentRunSummaryMiddleware(summaryRecorder),
    ] as any,
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
  const startTime = Date.now();
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;

  for (let attempt = 1; attempt <= REQUEST_AGENT_MAX_ATTEMPTS; attempt++) {
    const requestPayload = {
      product_context:
        input.productContext?.trim() || "No product context provided.",
      user_input: input.userInput,
      ...(attempt > 1
        ? {
            retry_instruction:
              "The previous response failed schema validation. Return only one valid JSON object that matches RequestAnalysisSchema exactly.",
          }
        : {}),
    };
    const summaryRecorder = createAgentRunSummaryRecorder({
      agentLabel: `Request Agent Attempt ${attempt}`,
      agentName: `request-agent-attempt-${attempt}`,
      agentType: "request",
      context: {
        attempt,
        maxAttempts: REQUEST_AGENT_MAX_ATTEMPTS,
        payload: requestPayload,
        systemPrompt: REQUEST_AGENT_PROMPT,
      },
    });
    const agent = createRequestAgent(summaryRecorder);
    let responseText = "";

    let run: AsyncIterable<[BaseMessage, unknown]>;
    try {
      run = await agent.stream(
        {
          messages: [new HumanMessage(JSON.stringify(requestPayload))],
        },
        { streamMode: "messages", signal: input.signal },
      );
    } catch (error) {
      await summaryRecorder.finish({
        error: getErrorMessage(error),
        output: responseText,
        status: "failed",
      });
      throw error;
    }

    try {
      for await (const [message] of run) {
        const reasoning = getReasoningContent(message);
        if (reasoning) {
          summaryRecorder.recordThinking(reasoning);
          yield { type: "reasoning", content: reasoning, agentType: "request" };
        }

        const text = getTextContent(message);
        responseText += text;
        summaryRecorder.recordOutput(text);

        // 从每次 AIMessage 中累积 token 用量。
        const usage = getTokenUsage(message);
        if (usage) {
          tokenUsage = usage;
        }
      }
    } catch (error) {
      await summaryRecorder.finish({
        error: getErrorMessage(error),
        output: responseText,
        status: "failed",
        tokenUsage: tokenUsage
          ? {
              ...tokenUsage,
              durationMs: Date.now() - startTime,
            }
          : undefined,
      });
      throw error;
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

      const tokenUsageSummary = tokenUsage
        ? {
            ...tokenUsage,
            durationMs: Date.now() - startTime,
          }
        : undefined;
      // 在返回 complete 前输出 token 用量和耗时。
      if (tokenUsage) {
        const cost = calculateCost(
          tokenUsage.cacheMissInputTokens,
          tokenUsage.cacheHitInputTokens,
          tokenUsage.outputTokens,
        );
        yield {
          type: "token-usage",
          agentType: "request",
          inputTokens: tokenUsage.inputTokens,
          cacheHitInputTokens: tokenUsage.cacheHitInputTokens,
          cacheMissInputTokens: tokenUsage.cacheMissInputTokens,
          outputTokens: tokenUsage.outputTokens,
          totalTokens: tokenUsage.totalTokens,
          costInput: cost.costInput,
          costOutput: cost.costOutput,
          costTotal: cost.costTotal,
          durationMs: Date.now() - startTime,
        };
      }

      await summaryRecorder.finish({
        output: result.data,
        status: "completed",
        tokenUsage: tokenUsageSummary,
      });
      yield { type: "complete", analysis: result.data };
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < REQUEST_AGENT_MAX_ATTEMPTS) {
        const content = "\nRequest Agent 输出结构校验失败，正在自动重试一次。\n";
        summaryRecorder.recordThinking(content);
        yield {
          type: "reasoning",
          content,
          agentType: "request",
        };
      }
      await summaryRecorder.finish({
        error: lastError.message,
        output: responseText,
        status: attempt < REQUEST_AGENT_MAX_ATTEMPTS ? "retry" : "failed",
        tokenUsage: tokenUsage
          ? {
              ...tokenUsage,
              durationMs: Date.now() - startTime,
            }
          : undefined,
      });
    }
  }

  throw (
    lastError ?? new Error("Request Agent did not produce a request analysis.")
  );
}

/**
 * 格式化 Request Analysis 块
 */
export function formatRequestAnalysisBlock(analysis: RequestAnalysis): string {
  // 保留可解析的结构化 JSON。
  return `<request-analysis>\n${JSON.stringify(analysis, null, 2)}\n</request-analysis>`;
}

/**
 * 提取异常的可读消息，用于本地汇总文件。
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
