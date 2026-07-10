/**
 * AI Shipping Executor 档案
 *
 * 定义 AI Shipping Executor Agent 的职责配置，包括领域、关注层、
 * 允许的实体/关系类型、技能映射和执行指南。
 *
 * Responsibilities:
 * - 创建和细化 Component、Evidence 实体
 * - 补全技术规范、架构约束和实现差异，记录预期与实现对比
 */

import type { ExecutorAgentProfile } from "../types";

/**
 * AI Shipping Executor 负责技术规范和实现差异图谱建模。
 */
export const aiShippingExecutorProfile = {
  agentType: "executor-ai-shipping",
  name: "AI Shipping Executor",
  displayName: "AI Shipping Executor",
  domain: "ai-shipping",
  focusLayer: "Component",
  graphRole: "Create and refine Component and Evidence entities, filling in technical specifications, constraints, and implementation gaps.",
  skillSource: "pm-skills/pm-ai-shipping/",
  referencePath: "references/executor/ai-shipping-executor",
  allowedEntityTypes: ["Component", "Evidence"],
  allowedRelationTypes: [
    "Implements",
    "Constrains",
    "Validates",
    "References",
    "Composes",
    "Custom",
  ],
  skills: ["shipping-artifacts", "intended-vs-implemented"],
  executionGuidelines: [
    "Convert architecture, permissions, APIs, variables, workflows, and test-coverage requirements into Component nodes.",
    "Use Component --Implements--> Feature only for feature implementation. Express Component dependencies with References or Custom, and decomposition with parent Component --Composes--> child Component.",
    "Convert expected-versus-actual implementation gaps into Evidence nodes, and connect them to relevant Feature or Component nodes with Validates relations.",
    "When technical facts are unclear, record them as risks or open questions.",
  ],
} as const satisfies ExecutorAgentProfile;
