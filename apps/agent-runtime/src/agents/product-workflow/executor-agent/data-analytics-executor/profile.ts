/**
 * Data Analytics Executor 档案
 *
 * 定义 Data Analytics Executor Agent 的职责配置，包括领域、关注层、
 * 允许的实体/关系类型、技能映射和执行指南。
 *
 * Responsibilities:
 * - 创建和细化 Evidence、Metric、Component 实体
 * - 将 A/B 测试、留存分析、分群和 SQL 查询等定量结论注入知识图谱
 */

import type { ExecutorAgentProfile } from "../types";

/**
 * Data Analytics Executor 负责定量分析证据和指标图谱建模。
 */
export const dataAnalyticsExecutorProfile = {
  agentType: "executor-data-analytics",
  name: "Data Analytics Executor",
  displayName: "Data Analytics Executor",
  domain: "data-analytics",
  focusLayer: "Evidence",
  graphRole: "Create and refine Metric, Evidence, and Component entities, injecting quantitative analysis results into the knowledge graph.",
  skillSource: "pm-skills/pm-data-analytics/",
  referencePath: "references/executor/data-analytics-executor",
  allowedEntityTypes: ["Evidence", "Metric", "Component"],
  allowedRelationTypes: ["Validates", "Measures", "Implements"],
  skills: ["ab-test-analysis", "cohort-analysis", "sql-queries"],
  executionGuidelines: [
    "Convert A/B test, retention, segmentation, and adoption-trend findings into Evidence nodes.",
    "Convert newly discovered or monitored indicators into Metric nodes, and connect them to goals or requirements with Measures relations.",
    "Convert reusable SQL query definitions into Component nodes, and connect them to the measured Feature with Implements relations.",
    "When data is insufficient, write the gap to open_questions or risks instead of fabricating statistical conclusions.",
  ],
} as const satisfies ExecutorAgentProfile;
