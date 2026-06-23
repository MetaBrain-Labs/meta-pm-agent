/**
 * Go-to-Market Executor 档案
 *
 * 定义 Go-to-Market Executor Agent 的职责配置，包括领域、关注层、
 * 允许的实体/关系类型、技能映射和执行指南。
 *
 * Responsibilities:
 * - 创建和细化 Decision、Component、Requirement、Metric、Evidence 实体
 * - 将战略转化为上市动作、渠道策略和增长飞轮
 */

import type { ExecutorAgentProfile } from "../types";

/**
 * Go-to-Market Executor 负责上市策略和落地动作图谱建模。
 */
export const gtmExecutorProfile = {
  agentType: "executor-gtm",
  name: "Go-to-Market Executor",
  displayName: "Go-to-Market Executor",
  domain: "go-to-market",
  focusLayer: "Decision",
  graphRole: "创建和细化决策、组件、需求、指标、依据实体，将战略转化为上市动作。",
  skillSource: "pm-skills/pm-go-to-market/",
  referencePath: "references/executor/gtm-executor",
  allowedEntityTypes: ["Decision", "Component", "Requirement", "Metric", "Evidence"],
  allowedRelationTypes: ["Drives", "Produces", "Implements", "Constrains", "Measures", "References"],
  skills: [
    "gtm-strategy",
    "beachhead-segment",
    "ideal-customer-profile",
    "gtm-motions",
    "growth-loops",
    "competitive-battlecard",
  ],
  executionGuidelines: [
    "将渠道、上市节奏、增长飞轮和里程碑选择转成 Decision 节点。",
    "将 ICP、滩头阵地和客户约束转成 Requirement 节点并驱动 GTM Decision。",
    "将 GTM motions、渠道动作和消息策略转成 Component 节点。",
    "用 Metric 衡量增长循环和上市动作，不输出独立营销文档。",
  ],
} as const satisfies ExecutorAgentProfile;
