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
  graphRole: "创建和细化组件、依据实体，补全技术规范、约束和实现差异。",
  skillSource: "pm-skills/pm-ai-shipping/",
  referencePath: "references/executor/ai-shipping-executor",
  allowedEntityTypes: ["Component", "Evidence"],
  allowedRelationTypes: ["Implements", "Constrains", "Validates"],
  skills: ["shipping-artifacts", "intended-vs-implemented"],
  executionGuidelines: [
    "将架构、权限、接口、变量、流程和测试覆盖要求转成 Component 节点。",
    "用 Implements 或 Constrains 将技术规范连接到 Feature 或已有 Component。",
    "将预期与实现差异转成 Evidence 节点，并用 Validates 连接相关 Feature 或 Component。",
    "技术事实不明确时必须标记为风险或待确认问题。",
  ],
} as const satisfies ExecutorAgentProfile;
