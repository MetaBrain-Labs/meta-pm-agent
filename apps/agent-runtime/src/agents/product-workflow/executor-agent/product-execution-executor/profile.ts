/**
 * Product Execution Executor 档案
 *
 * 定义 Product Execution Executor Agent 的职责配置，包括领域、关注层、
 * 允许的实体/关系类型、技能映射和执行指南。
 *
 * Responsibilities:
 * - 创建和细化全部 8 种实体类型
 * - 将 Feature 逐层拆细为 Component，建立实现层级图谱结构
 * - 负责 PRD、用户故事、路线图等内容到图谱节点的转译
 */

import type { ExecutorAgentProfile } from "../types";

/**
 * Product Execution Executor 负责功能拆解和实现组件层图谱建模。
 */
export const productExecutionExecutorProfile = {
  agentType: "executor-product-execution",
  name: "Product Execution Executor",
  displayName: "Product Execution Executor",
  domain: "product-execution",
  focusLayer: "Feature",
  graphRole: "Break Feature nodes into sub-features and Components, establishing an implementation hierarchy in the graph.",
  skillSource: "pm-skills/pm-execution/",
  referencePath: "references/executor/product-execution-executor",
  allowedEntityTypes: [
    "Feature",
    "Component",
    "Requirement",
    "Metric",
    "Evidence",
    "Goal",
    "Decision",
    "Custom",
  ],
  allowedRelationTypes: [
    "Composes",
    "Satisfies",
    "Implements",
    "Constrains",
    "Measures",
    "Validates",
    "References",
    "Drives",
    "Produces",
    "Custom",
  ],
  skills: [
    "create-prd",
    "user-stories",
    "job-stories",
    "wwas",
    "sprint-plan",
    "brainstorm-okrs",
    "outcome-roadmap",
    "prioritization-frameworks",
    "test-scenarios",
    "strategy-red-team",
    "pre-mortem",
    "stakeholder-map",
    "summarize-meeting",
    "release-notes",
    "retro",
    "dummy-dataset",
  ],
  executionGuidelines: [
    "Translate PRDs, user stories, job stories, and roadmap content into Feature, Requirement, Decision, or Component nodes.",
    "Use Composes to break down Feature nodes, and connect implementation Component nodes with Implements relations.",
    "Convert acceptance scenarios, risks, retrospectives, and meeting conclusions into Evidence nodes or Component constraints.",
    "Produce graph deltas only; do not generate PRD, release-note, or meeting-minutes document bodies.",
  ],
} as const satisfies ExecutorAgentProfile;
