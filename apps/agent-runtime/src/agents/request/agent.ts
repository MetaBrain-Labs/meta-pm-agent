import { HumanMessage } from "langchain";
import { createDeepAgent } from "deepagents";
import { RequestAnalysisSchema, type RequestAnalysis } from "@repo/shared";
import { createChatModel } from "../common/model";
import { REQUEST_AGENT_PROMPT } from "./prompt";
import { getTextContent } from "../../utils/message-adapter";
import { parseJsonObject } from "../../utils/json";
import type { UserInputRecord } from "./user-input";

export interface RequestAgentInput {
  productContext?: string;
  userInput: UserInputRecord[];
}

/**
 * 创建真正的 Request Agent，由 DeepAgent 承载 system prompt 和模型调用。
 */
export function createRequestAgent() {
  const model = createChatModel();
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
          }),
        ),
      ],
    },
    { streamMode: "messages" },
  );

  let responseText = "";
  for await (const [message] of run) {
    responseText += getTextContent(message);
  }

  // LLM 输出必须先通过结构校验，避免下游图节点和 API 处理不符合约定的数据。
  const parsed = parseJsonObject(responseText);
  const result = RequestAnalysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      "Request Agent did not produce a valid request analysis payload.",
    );
  }

  assertEveryUserInputCovered(result.data, input.userInput);
  return result.data;
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
