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
  graphRole: "创建和细化目标、决策、需求、依据实体，建立顶层产品因果链。",
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
    "将顶层业务意图转成可追踪的 Goal 节点，并用 Composes 拆分为子目标。",
    "将战略、商业模式、定价、盈利和增长路径选择转成 Decision 节点。",
    "将 SWOT、五力、PESTLE 等结论转成 Evidence 节点，并通过 References 或 Validates 支撑 Decision。",
    "所有 Decision 必须通过 Drives、Produces 或 References 嵌入目标到功能的因果链。",
  ],
} as const satisfies ExecutorAgentProfile;
