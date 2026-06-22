import type { ExecutorAgentProfile } from "../types";

/**
 * Toolkit Executor 负责合规和辅助类图谱建模。
 */
export const toolkitExecutorProfile = {
  agentType: "executor-toolkit",
  name: "Toolkit Executor",
  displayName: "Toolkit Executor",
  domain: "toolkit",
  focusLayer: "Custom",
  graphRole: "处理辅助性、合规类产物，主要创建自定义实体和少量组件约束节点。",
  skillSource: "pm-skills/pm-toolkit/",
  referencePath: "references/executor/toolkit-executor",
  allowedEntityTypes: ["Component", "Custom"],
  allowedRelationTypes: ["Constrains", "Custom", "References"],
  skills: ["privacy-policy", "draft-nda", "grammar-check", "review-resume"],
  executionGuidelines: [
    "将隐私合规约束转成 Component 节点，并用 Constrains 连接相关 Feature。",
    "将 NDA、人才评估等辅助内容转成 Custom 节点，并用 Custom 或 References 关系说明上下文。",
    "语法审视任务只更新已有节点描述质量，不创建无关主链路节点。",
    "保持辅助内容与产品设计主链路松耦合。",
  ],
} as const satisfies ExecutorAgentProfile;
