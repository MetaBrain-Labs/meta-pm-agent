/**
 * Planner SubAgent 构造与结果提取
 *
 * 定义 DeepAgents SubAgent 的构造逻辑（createPlannerSubagent）以及从 task 工具
 * 返回结果中提取、校验 TaskExecutionPlan 的完整流程。
 *
 * Responsibilities:
 * - createPlannerSubagent()：构造零工具权限的 Planner DeepAgent SubAgent
 * - extractPlanFromSubagentResult()：从 SubAgent 输出中解析并归一化 DAG
 * - resolveToolMessageContent()：归一化 DeepAgents ToolMessage 内容为可解析字符串
 */

import type { SubAgent } from "deepagents";
import {
  TaskExecutionPlanSchema,
  type TaskExecutionPlan,
} from "@repo/shared";
import { createDeepAgentToolAllowlistMiddleware } from "../../../common/deep-agent-tool-policy";
import { parseJsonObject } from "../../../../utils/json";
import type { OrchestratorAgentInput } from "../../types";
import { PLANNER_SUBAGENT_PROMPT } from "./prompt";
import {
  normalizeTaskExecutionPlan,
  createFallbackPlan,
} from "./plan";

/**
 * 创建 Planner 子代理；该子代理接收完整产品上下文并通过 task 描述返回 DAG JSON。
 * 子代理无工具权限，仅从 task 描述中读取上下文并返回结构化 JSON。
 */
export function createPlannerSubagent(): SubAgent {
  const subagentToolAllowlistMiddleware =
    createDeepAgentToolAllowlistMiddleware({
      agentName: "orchestrator-planner-subagent",
      allowedToolNames: [],
    });

  return {
    name: "planner-agent",
    description:
      "Generates executable TaskExecutionPlan DAG from product request analysis and knowledge graph context. Returns JSON matching TaskExecutionPlanSchema.",
    systemPrompt: PLANNER_SUBAGENT_PROMPT,
    tools: [],
    middleware: [subagentToolAllowlistMiddleware],
  };
}

/**
 * 从 Planner SubAgent 的 task 工具结果中提取并校验 TaskExecutionPlan。
 * 提取失败时回退到确定性 fallback DAG。
 */
export function extractPlanFromSubagentResult(
  rawResult: unknown,
  input: OrchestratorAgentInput,
): TaskExecutionPlan {
  if (rawResult === null || rawResult === undefined) {
    return normalizeTaskExecutionPlan(
      createFallbackPlan(input, "Planner subagent was not invoked or returned no output"),
    );
  }

  const content = resolveToolMessageContent(rawResult);
  if (content === null) {
    return normalizeTaskExecutionPlan(
      createFallbackPlan(input, "Planner subagent returned no parseable output"),
    );
  }

  const parsed = parseJsonObject(content);
  if (parsed === null) {
    return normalizeTaskExecutionPlan(
      createFallbackPlan(input, "Planner subagent output was not valid JSON"),
    );
  }

  const result = TaskExecutionPlanSchema.safeParse(parsed);
  if (result.success) {
    return normalizeTaskExecutionPlan(result.data);
  }

  return normalizeTaskExecutionPlan(
    createFallbackPlan(
      input,
      `Planner subagent output failed schema validation`,
    ),
  );
}

/**
 * 将 ToolMessage 的 content 归一化为可解析的字符串。
 * DeepAgents 可能返回 string、数组或嵌套对象。
 */
export function resolveToolMessageContent(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    // LangChain 复合内容块 {"type":"text","text":"..."} 格式
    if (first && typeof first === "object" && "text" in first) {
      return String((first as { text: unknown }).text);
    }
    return String(first);
  }
  if (raw && typeof raw === "object" && "text" in raw) {
    return String((raw as { text: unknown }).text);
  }
  return null;
}
