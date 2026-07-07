/**
 * Pre-Orchestrator SubAgent 构造与结果提取
 *
 * 定义 DeepAgents SubAgent 的构造逻辑（createPreOrchestratorSubagent）以及从 task 工具
 * 返回结果中提取、校验 PreOrchResult 的完整流程。
 *
 * Responsibilities:
 * - createPreOrchestratorSubagent()：构造零工具权限的 Pre-Orchestrator SubAgent
 * - extractPreOrchFromSubagentResult()：从 SubAgent 输出中解析并校验 PreOrchResult
 * - extractPreOrchReasoning()：提取 SubAgent 推理摘要供前端展示
 * - resolveToolMessageContent()：归一化 DeepAgents ToolMessage 内容为可解析字符串
 */

import type { SubAgent } from "deepagents";
import { createDeepAgentToolAllowlistMiddleware } from "../../../common/deep-agent-tool-policy";
import { parseJsonObject } from "../../../../utils/json";
import { PRE_ORCHESTRATOR_SUBAGENT_PROMPT } from "./prompt";
import {
  PreOrchResultSchema,
  type PreOrchResult,
  type PreOrchestratorInput,
  createFallbackPreOrchResult,
} from "./result";

/**
 * 创建 Pre-Orchestrator 子代理；该子代理接收用户消息和产品上下文并通过 task 描述
 * 返回意图分类和路由决策 JSON。子代理无工具权限，仅从 task 描述中读取上下文。
 */
export function createPreOrchestratorSubagent(): SubAgent {
  const subagentToolAllowlistMiddleware =
    createDeepAgentToolAllowlistMiddleware({
      agentName: "orchestrator-pre-orchestrator-subagent",
      allowedToolNames: [],
    });

  return {
    name: "pre-orchestrator",
    description:
      "Classifies user intent (casual_chat/new_project/project_evolution) based on product context and generates clarification questions when needed. Returns a JSON with intent, decision, reason, and optional questions.",
    systemPrompt: PRE_ORCHESTRATOR_SUBAGENT_PROMPT,
    tools: [],
    middleware: [subagentToolAllowlistMiddleware],
  };
}

/**
 * 从 Pre-Orchestrator SubAgent 的 task 工具结果中提取并校验 PreOrchResult。
 * 提取失败时回退到确定性结果。
 */
export function extractPreOrchFromSubagentResult(
  rawResult: unknown,
  input: PreOrchestratorInput,
): PreOrchResult {
  if (rawResult === null || rawResult === undefined) {
    return createFallbackPreOrchResult(input);
  }

  const parsed = resolvePreOrchResultCandidate(rawResult);
  if (parsed === null) {
    return createFallbackPreOrchResult(input);
  }

  const result = PreOrchResultSchema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }

  return createFallbackPreOrchResult(input);
}

/**
 * 将 SubAgent 返回值或 Orchestrator 已解析结果归一化为可校验对象。
 */
function resolvePreOrchResultCandidate(rawResult: unknown): unknown | null {
  if (
    rawResult &&
    typeof rawResult === "object" &&
    !Array.isArray(rawResult) &&
    !("text" in rawResult) &&
    !("content" in rawResult)
  ) {
    return rawResult;
  }

  const content = resolveToolMessageContent(rawResult);
  return content === null ? null : parseJsonObject(content);
}

/**
 * 提取 SubAgent reasoning 摘要，供前端展示推理过程。
 */
export function extractPreOrchReasoning(rawResult: unknown): string {
  const content = resolveToolMessageContent(rawResult);
  if (!content) return "意图分类完成。";

  const parsed = parseJsonObject(content);
  if (!parsed || typeof parsed !== "object") return "意图分类完成。";

  const record = parsed as Record<string, unknown>;
  const reason = typeof record.reason === "string" ? record.reason : "";
  const intent = typeof record.intent === "string" ? record.intent : "";
  const decision = typeof record.decision === "string" ? record.decision : "";

  if (reason) return reason;
  return `意图：${intent}，决策：${decision}`;
}

/**
 * 将 DeepAgents ToolMessage 的 content 归一化为可解析的字符串。
 */
export function resolveToolMessageContent(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    if (first && typeof first === "object" && "text" in first) {
      return String((first as { text: unknown }).text);
    }
    return String(first);
  }
  if (raw && typeof raw === "object" && "text" in raw) {
    return String((raw as { text: unknown }).text);
  }
  if (raw && typeof raw === "object" && "content" in raw) {
    return resolveToolMessageContent((raw as { content: unknown }).content);
  }
  return null;
}
