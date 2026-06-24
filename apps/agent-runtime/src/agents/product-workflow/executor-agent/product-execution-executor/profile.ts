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
  graphRole: "将功能节点逐层拆细为子功能和组件，建立实现层级图谱结构。",
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
    "将 PRD、用户故事、Job Story 和路线图内容转译为 Feature、Requirement、Decision 或 Component 节点。",
    "核心职责是用 Composes 拆细 Feature，并用 Implements 连接实现 Component。",
    "将验收场景、风险、复盘和会议结论转成 Evidence 或 Component 约束。",
    "只产出图谱增量，不生成 PRD、发布说明或会议纪要文档正文。",
  ],
} as const satisfies ExecutorAgentProfile;
