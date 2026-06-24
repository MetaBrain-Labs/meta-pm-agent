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
  graphRole: "创建和细化需求、功能、依据、指标实体，将模糊意图转成可验证功能假设。",
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
    "将机会、JTBD、用户反馈和旅程痛点转成 Requirement 节点。",
    "将解决方案想法和候选方案转成 Feature 节点，并用 Satisfies 连接 Requirement。",
    "将访谈、实验和假设分析转成 Evidence 节点，并用 Validates 连接待验证对象。",
    "通过 Composes 对 Requirement 或 Feature 做层级拆分，保留优先级和不确定性。",
  ],
} as const satisfies ExecutorAgentProfile;
