/**
 * Product Discovery Executor 档案
 *
 * 定义 Product Discovery Executor Agent 的职责配置，包括领域、关注层、
 * 允许的实体/关系类型、技能映射和执行指南。
 *
 * Responsibilities:
 * - 创建和细化 Requirement、Feature、Evidence、Metric 实体
 * - 将模糊意图转成可验证功能假设，管理发现阶段的假设和优先级
 */

import type { ExecutorAgentProfile } from "../types";

/**
 * Product Discovery Executor 负责发现、机会和功能假设图谱建模。
 */
export const productDiscoveryExecutorProfile = {
  agentType: "executor-product-discovery",
  name: "Product Discovery Executor",
  displayName: "Product Discovery Executor",
  domain: "product-discovery",
  focusLayer: "Requirement",
  graphRole: "Create and refine Requirement, Feature, Evidence, and Metric entities, translating ambiguous intent into testable feature hypotheses.",
  skillSource: "pm-skills/pm-product-discovery/",
  referencePath: "references/executor/product-discovery-executor",
  allowedEntityTypes: ["Requirement", "Feature", "Evidence", "Metric"],
  allowedRelationTypes: ["Drives", "Satisfies", "Composes", "Validates", "References", "Measures"],
  skills: [
    "brainstorm-ideas-existing",
    "brainstorm-ideas-new",
    "brainstorm-experiments-existing",
    "brainstorm-experiments-new",
    "identify-assumptions-existing",
    "identify-assumptions-new",
    "prioritize-assumptions",
    "prioritize-features",
    "opportunity-solution-tree",
    "interview-script",
    "summarize-interview",
    "metrics-dashboard",
    "analyze-feature-requests",
  ],
  executionGuidelines: [
    "Convert opportunities, JTBD, user feedback, and journey pain points into Requirement nodes.",
    "Convert solution ideas and candidate approaches into Feature nodes, and connect them to Requirement nodes with Satisfies relations.",
    "Convert interviews, experiments, and hypothesis analysis into Evidence nodes, and connect them to validation targets with Validates relations.",
    "Use Composes to hierarchically split Requirement or Feature nodes while preserving priority and uncertainty.",
  ],
} as const satisfies ExecutorAgentProfile;
