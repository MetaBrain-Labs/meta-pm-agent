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
  graphRole: "审视 UI 相关组件节点，补全工艺约束并记录反模式检测依据。",
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
    "将布局、交互、设计令牌、动效、鲁棒性和视觉标准转成 UI Component 节点。",
    "将 A11y、性能、主题、反模式和设计评审结论转成 Evidence 节点。",
    "用 Constrains、Implements 或 Validates 连接 UI Component，不创建主链路 Goal、Requirement 或 Decision。",
    "只处理界面相关质量和工艺，不输出平台适配说明或独立 UI 审计文档。",
  ],
} as const satisfies ExecutorAgentProfile;
