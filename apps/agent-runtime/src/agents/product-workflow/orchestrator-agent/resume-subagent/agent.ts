/**
 * Resume Agent 独立执行
 *
 * 以独立 DeepAgent 直接运行恢复判断，绕过 Orchestrator + task 工具的间接委托路径。
 * DeepAgents 内置的 TASK_SYSTEM_PROMPT 会导致模型将恢复判断视为 trivial task 而跳过委托，
 * 因此必须绕过该机制，直接以独立 Agent 运行 resume-checker。
 *
 * Responsibilities:
 * - runResumeCheckDirectly()：以独立 DeepAgent 直接运行恢复判断，不依赖 Orchestrator 模型委托
 */
import { createDeepAgent } from "deepagents";
import { HumanMessage } from "langchain";
import { calculateCost } from "../../../../config";
import { createChatModel } from "../../../common/model";
import { createDefaultAgentMiddleware } from "../../../common/middleware";
import { parseJsonObject } from "../../../../utils/json";
import {
  getReasoningContent,
  getTextContent,
  getTokenUsage,
} from "../../../../utils/message-adapter";
import {
  OrchestratorResumeCheckResultSchema,
  type OrchestratorResumeCheckResult,
} from "@repo/shared";
import type { ProductWorkflowStreamEvent } from "../../types";
import { RESUME_SUBAGENT_PROMPT } from "./prompt";
import {
  buildResumePayload,
  createFallbackResumeCheckResult,
  type ResumeSubagentInput,
} from "./result";

/**
 * 以独立 DeepAgent 直接运行恢复判断，绕过 Orchestrator 的 task 工具委托。
 * 使用 json_object 响应格式确保模型输出可解析的 JSON。
 */
export async function* runResumeCheckDirectly(
  input: ResumeSubagentInput,
): AsyncGenerator<
  ProductWorkflowStreamEvent,
  OrchestratorResumeCheckResult,
  void
> {
  const startTime = Date.now();
  const payload = buildResumePayload(input);

  const agent = createDeepAgent({
    model: createChatModel({
      enableThinking: false,
      temperature: 0,
      responseFormat: "json_object",
      maxTokens: 1024,
    }) as any,
    systemPrompt: RESUME_SUBAGENT_PROMPT,
    tools: [],
    name: "resume-checker",
    middleware: [...createDefaultAgentMiddleware()] as any,
  });

  const stream = await agent.stream(
    { messages: [new HumanMessage(JSON.stringify(payload))] },
    { streamMode: "messages", signal: input.signal },
  );

  let responseText = "";
  let tokenUsage: ReturnType<typeof getTokenUsage> = null;

  for await (const [message] of stream) {
    const reasoning = getReasoningContent(message);
    if (reasoning) {
      yield {
        type: "reasoning",
        agentType: "orchestrator",
        content: reasoning,
      };
    }

    responseText += getTextContent(message);

    const usage = getTokenUsage(message);
    if (usage) tokenUsage = usage;
  }

  if (tokenUsage) {
    const cost = calculateCost(
      tokenUsage.cacheMissInputTokens,
      tokenUsage.cacheHitInputTokens,
      tokenUsage.outputTokens,
    );
    yield {
      type: "token-usage",
      agentType: "orchestrator",
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

  const parsed = parseJsonObject(responseText);
  if (parsed === null) {
    return createFallbackResumeCheckResult(
      "resume-check agent returned unparseable JSON",
    );
  }

  const result = OrchestratorResumeCheckResultSchema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }

  return createFallbackResumeCheckResult(
    "resume-check agent output failed schema validation",
  );
}
