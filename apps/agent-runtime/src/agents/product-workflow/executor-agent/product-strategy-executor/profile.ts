/**
 * Product Strategy Executor 档案
 *
 * 定义 Product Strategy Executor Agent 的职责配置，包括领域、关注层、
 * 允许的实体/关系类型、技能映射和执行指南。
 *
 * Responsibilities:
 * - 创建和细化 Goal、Decision、Requirement、Evidence 实体
 * - 建立顶层产品因果链，将战略意图转成可追踪的 Goal 节点
 */

import type { ExecutorAgentProfile } from "../types";

/**
 * Product Strategy Executor 负责战略层图谱建模。
 */
export const productStrategyExecutorProfile = {
  agentType: "executor-product-strategy",
  name: "Product Strategy Executor",
  displayName: "Product Strategy Executor",
  domain: "product-strategy",
  focusLayer: "Goal",
  graphRole: "Create and refine Goal, Decision, Requirement, and Evidence entities, establishing the top-level product causal chain.",
  skillSource: "pm-skills/pm-product-strategy/",
  referencePath: "references/executor/product-strategy-executor",
  allowedEntityTypes: ["Goal", "Decision", "Requirement", "Evidence"],
  allowedRelationTypes: ["Composes", "Drives", "Produces", "References", "Validates"],
  skills: [
    "product-vision",
    "product-strategy",
    "business-model",
    "lean-canvas",
    "startup-canvas",
    "ansoff-matrix",
    "swot-analysis",
    "porters-five-forces",
    "pestle-analysis",
    "value-proposition",
    "pricing-strategy",
    "monetization-strategy",
  ],
  executionGuidelines: [
    "Convert top-level business intent into traceable Goal nodes, and split them into sub-goals with Composes relations.",
    "Convert strategy, business model, pricing, monetization, and growth-path choices into Decision nodes.",
    "Convert SWOT, Five Forces, PESTLE, and similar findings into Evidence nodes, and support Decision nodes with References or Validates relations.",
    "Every Decision must be embedded into the goal-to-feature causal chain with Drives, Produces, or References relations.",
    "Never use Drives between two Decision nodes or from Goal directly to Requirement. Use References for decision dependencies and preserve Goal --Drives--> Decision --Produces--> Requirement.",
  ],
} as const satisfies ExecutorAgentProfile;
