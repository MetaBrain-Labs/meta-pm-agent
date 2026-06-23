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
  graphRole: "创建和细化指标、依据、组件实体，将定量分析结果注入知识图谱。",
  skillSource: "pm-skills/pm-data-analytics/",
  referencePath: "references/executor/data-analytics-executor",
  allowedEntityTypes: ["Evidence", "Metric", "Component"],
  allowedRelationTypes: ["Validates", "Measures", "Implements"],
  skills: ["ab-test-analysis", "cohort-analysis", "sql-queries"],
  executionGuidelines: [
    "将 A/B 测试、留存、分群和采用趋势结论转成 Evidence 节点。",
    "将新发现或需监控的指标转成 Metric 节点，并用 Measures 连接目标或需求。",
    "将可复用 SQL 查询定义转成 Component 节点，并用 Implements 连接 Metric。",
    "数据不足时把缺口写入 open_questions 或 risks，不伪造统计结论。",
  ],
} as const satisfies ExecutorAgentProfile;
