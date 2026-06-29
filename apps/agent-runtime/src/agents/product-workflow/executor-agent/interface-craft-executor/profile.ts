/**
 * Interface Craft Executor 档案
 *
 * 定义 Interface Craft Executor Agent 的职责配置，包括领域、关注层、
 * 允许的实体/关系类型、技能映射和执行指南。
 *
 * Responsibilities:
 * - 创建和细化 Component、Evidence 实体
 * - 审视 UI 相关组件节点，补全布局、交互、可访问性和视觉工艺约束
 * - 记录反模式检测依据，不输出独立 UI 审计文档
 */

import type { ExecutorAgentProfile } from "../types";

/**
 * Interface Craft Executor 负责 UI 组件质量和界面工艺图谱建模。
 */
export const interfaceCraftExecutorProfile = {
  agentType: "executor-interface-craft",
  name: "Interface Craft Executor",
  displayName: "Interface Craft Executor",
  domain: "interface-craft",
  focusLayer: "Component",
  graphRole: "Review UI-related Component nodes, fill in craft constraints, and record evidence for anti-pattern detection.",
  skillSource: "references/impeccable/",
  referencePath: "references/executor/interface-craft-executor",
  allowedEntityTypes: ["Component", "Evidence"],
  allowedRelationTypes: ["Constrains", "Implements", "Validates"],
  skills: [
    "shape",
    "layout",
    "craft",
    "bolder",
    "quieter",
    "animate",
    "delight",
    "colorize",
    "audit",
    "harden",
    "polish",
    "critique",
    "codex",
  ],
  executionGuidelines: [
    "Convert layout, interaction, design-token, motion, robustness, and visual standards into UI Component nodes.",
    "Convert accessibility, performance, theming, anti-pattern, and design-review findings into Evidence nodes.",
    "Connect UI Component nodes with Constrains, Implements, or Validates relations; do not create main-flow Goal, Requirement, or Decision nodes.",
    "Handle only interface quality and craft; do not output platform adaptation notes or standalone UI audit documents.",
  ],
} as const satisfies ExecutorAgentProfile;
