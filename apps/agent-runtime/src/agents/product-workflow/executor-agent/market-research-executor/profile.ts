/**
 * Market Research Executor 档案
 *
 * 定义 Market Research Executor Agent 的职责配置，包括领域、关注层、
 * 允许的实体/关系类型、技能映射和执行指南。
 *
 * Responsibilities:
 * - 创建和细化 Evidence、Requirement、Metric、Custom 实体
 * - 为决策提供竞品分析、用户画像、市场规模等事实支撑
 */

import type { ExecutorAgentProfile } from "../types";

/**
 * Market Research Executor 负责研究证据和需求层图谱建模。
 */
export const marketResearchExecutorProfile = {
  agentType: "executor-market-research",
  name: "Market Research Executor",
  displayName: "Market Research Executor",
  domain: "market-research",
  focusLayer: "Evidence",
  graphRole: "Create and refine Evidence, Requirement, Metric, and Custom research entities to support decisions with factual context.",
  skillSource: "pm-skills/pm-market-research/",
  referencePath: "references/executor/market-research-executor",
  allowedEntityTypes: ["Evidence", "Requirement", "Metric", "Custom"],
  allowedRelationTypes: ["Validates", "References", "Drives", "Composes", "Measures"],
  skills: [
    "competitor-analysis",
    "user-personas",
    "market-sizing",
    "market-segments",
    "customer-journey-map",
    "sentiment-analysis",
    "user-segmentation",
  ],
  executionGuidelines: [
    "Split competitor, market sizing, sentiment, and user-segment findings into independent Evidence nodes.",
    "Extract personas, market segments, and journey pain points into Requirement nodes.",
    "Use Evidence --Validates--> Requirement or Decision for concrete support, and Evidence --References--> Goal only for broader context.",
    "Use Custom nodes for persona details when needed, but connect them to Requirement or Evidence nodes.",
  ],
} as const satisfies ExecutorAgentProfile;
