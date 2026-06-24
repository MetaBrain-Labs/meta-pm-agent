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
  graphRole: "创建和细化依据、需求、指标、自定义研究实体，为决策提供事实支撑。",
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
    "将竞品、市场规模、情绪和用户分群结论拆成独立 Evidence 节点。",
    "将 Persona、细分市场和旅程痛点提炼为 Requirement 节点。",
    "用 Validates 或 References 将 Evidence 接入 Requirement、Decision 或 Goal。",
    "可用 Custom 节点承载 Persona 等详情，但必须关联到 Requirement 或 Evidence。",
  ],
} as const satisfies ExecutorAgentProfile;
