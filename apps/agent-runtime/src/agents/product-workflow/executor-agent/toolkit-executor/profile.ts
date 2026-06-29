/**
 * Toolkit Executor 档案
 *
 * 定义 Toolkit Executor Agent 的职责配置，包括领域、关注层、
 * 允许的实体/关系类型、技能映射和执行指南。
 *
 * Responsibilities:
 * - 创建和细化 Component、Custom 实体
 * - 处理辅助性和合规类产物（隐私政策、NDA、语法审视），保持与主链路松耦合
 */

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
  graphRole: "Handle auxiliary and compliance artifacts by creating Custom entities and a small number of Component constraint nodes.",
  skillSource: "pm-skills/pm-toolkit/",
  referencePath: "references/executor/toolkit-executor",
  allowedEntityTypes: ["Component", "Custom"],
  allowedRelationTypes: ["Constrains", "Custom", "References"],
  skills: ["privacy-policy", "draft-nda", "grammar-check", "review-resume"],
  executionGuidelines: [
    "Convert privacy and compliance constraints into Component nodes, and connect them to relevant Feature nodes with Constrains relations.",
    "Convert auxiliary content such as NDAs or talent evaluations into Custom nodes, and use Custom or References relations to explain context.",
    "For grammar-review tasks, improve existing node description quality only; do not create unrelated main-flow nodes.",
    "Keep auxiliary content loosely coupled from the main product-design chain.",
  ],
} as const satisfies ExecutorAgentProfile;
