/**
 * 产品工作流共享契约
 *
 * 定义 Planner、Executor、产品知识图谱和工作流确认结果在 runtime、API 与前端之间
 * 传递时使用的 Zod schema 与 TypeScript 类型。
 *
 * Responsibilities:
 * - 约束产品知识图谱节点、关系、决策、风险和待确认问题结构
 * - 定义 Planner DAG、Executor 结果和最终工作流结果契约
 * - 为跨包消费者导出稳定类型
 *
 * Notes:
 * - LLM-facing schema descriptions must remain in English.
 */

import { z } from "zod";

/**
 * 产品工作流中可持久化、可展示的稳定 Agent 类型。
 */
export const ProductWorkflowAgentTypeSchema = z.enum([
  "planner",
  "executor-product-strategy",
  "executor-market-research",
  "executor-gtm",
  "executor-product-discovery",
  "executor-product-execution",
  "executor-marketing-growth",
  "executor-data-analytics",
  "executor-ai-shipping",
  "executor-toolkit",
  "executor-interface-craft",
]);

const PRODUCT_WORKFLOW_AGENT_TYPES = ProductWorkflowAgentTypeSchema.options;

/**
 * 归一化模型输出的 Agent 类型，避免局部来源字段写偏导致整个 Planner Review 回退。
 */
const LooseProductWorkflowAgentTypeSchema = z.preprocess(
  (value) =>
    typeof value === "string" &&
    PRODUCT_WORKFLOW_AGENT_TYPES.includes(
      value as (typeof PRODUCT_WORKFLOW_AGENT_TYPES)[number],
    )
      ? value
      : "planner",
  ProductWorkflowAgentTypeSchema,
);

/**
 * 产品知识图谱节点的最小 MVP 表达，后续可替换为正式图谱存储。
 */
export const KnowledgeGraphEntitySchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "Goal",
    "Requirement",
    "Evidence",
    "Decision",
    "Feature",
    "Component",
    "Metric",
    "Risk",
    "OpenQuestion",
    "Custom",
  ]),
  name: z.string().min(1),
  description: z.string().optional(),
  source_task_id: z.string().optional(),
  status: z.enum(["proposed", "confirmed", "deprecated"]).optional(),
});

/**
 * Executor Agent 写入图谱的结构化节点输入，要求更强的字段约束。
 */
export const KnowledgeGraphNodeInputSchema = z.object({
  id: z.string().min(1).describe("Unique node ID, e.g. G-001, D-003, R-012"),
  type: z.enum([
    "Goal",
    "Requirement",
    "Evidence",
    "Decision",
    "Feature",
    "Component",
    "Metric",
    "Risk",
    "OpenQuestion",
    "Custom",
  ]).describe("Entity type"),
  name: z.string().min(1).describe("Node name"),
  description: z.string().min(1).describe("Node description explaining its business meaning"),
  source_task_id: z.string().min(1).describe("Executor task ID that produced this node"),
  status: z.enum(["proposed", "confirmed", "deprecated"]).default("proposed").describe("Node status"),
});

/**
 * 产品知识图谱关系的最小 MVP 表达，用于记录 Agent 的图谱增量建议。
 */
export const KnowledgeGraphRelationSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "Drives",
    "Satisfies",
    "Promotes",
    "Produces",
    "Constrains",
    "Implements",
    "Measures",
    "Validates",
    "References",
    "Composes",
    "Custom",
  ]),
  source: z.string().min(1),
  target: z.string().min(1),
  description: z.string().optional(),
  source_task_id: z.string().optional(),
});

/**
 * Executor Agent 写入图谱的结构化关系输入，要求更强的字段约束。
 */
export const KnowledgeGraphRelationInputSchema = z.object({
  id: z.string().min(1).describe("Unique relation ID, e.g. REL-001"),
  type: z.enum([
    "Drives",
    "Satisfies",
    "Promotes",
    "Produces",
    "Constrains",
    "Implements",
    "Measures",
    "Validates",
    "References",
    "Composes",
    "Custom",
  ]).describe("Relation type"),
  source: z.string().min(1).describe("Source node ID"),
  target: z.string().min(1).describe("Target node ID"),
  description: z.string().min(1).describe("Relation description explaining the business connection"),
  source_task_id: z.string().min(1).describe("Executor task ID that produced this relation"),
});

/**
 * 结构化决策输入。
 */
export const KnowledgeGraphDecisionInputSchema = z.object({
  id: z.string().min(1).describe("Decision ID, e.g. D-001"),
  text: z.string().min(1).describe("Decision text including choice, rationale, and risk assessment"),
  source_task_id: z.string().optional().describe("Optional executor task ID that produced this decision"),
});

/**
 * 结构化风险输入。
 */
export const KnowledgeGraphRiskInputSchema = z.object({
  id: z.string().min(1).describe("Risk ID, e.g. RISK-001"),
  text: z.string().min(1).describe("Risk description including impact and mitigation"),
  source_task_id: z.string().optional().describe("Optional executor task ID that produced this risk"),
});

/**
 * 结构化待确认问题输入。
 */
export const KnowledgeGraphOpenQuestionInputSchema = z.object({
  id: z.string().min(1).describe("Question ID, e.g. OQ-001"),
  text: z.string().min(1).describe("Question text explaining what needs to be confirmed"),
  source_task_id: z.string().optional().describe("Optional executor task ID that raised this question"),
});

const ProductWorkflowProposalQuestionTypeSchema = z.preprocess((value) => {
  if (value === "single_choice" || value === "choice") return "radio";
  if (value === "multiple_choice" || value === "multi_select") return "checkbox";
  if (
    value === "radio" ||
    value === "checkbox" ||
    value === "select" ||
    value === "text" ||
    value === "textarea"
  ) {
    return value;
  }
  return "textarea";
}, z.enum(["radio", "checkbox", "select", "text", "textarea"]));

const ProductWorkflowProposalQuestionOptionSchema = z.preprocess((value) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.label === "string") return record.label;
    if (typeof record.value === "string") return record.value;
    if (typeof record.text === "string") return record.text;
  }
  return "";
}, z.string().min(1));

const ProductWorkflowProposalQuestionSourceSchema = z.object({
  source_task_id: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value : "unknown-task"),
    z.string().min(1).describe("Executor task ID that raised this question"),
  ),
  source_agent: LooseProductWorkflowAgentTypeSchema.describe("Agent that raised this question"),
});

/**
 * Planner Agent 输出给 Conversation Agent 渲染的结构化 Question Form 问题。
 */
export const ProductWorkflowProposalQuestionSchema = z.object({
  id: z.string().min(1).describe("Stable field ID used in the submitted form answer"),
  label: z.string().min(1).describe("User-facing question label"),
  type: ProductWorkflowProposalQuestionTypeSchema.describe("Question Form control type chosen by Planner Agent"),
  options: z.array(ProductWorkflowProposalQuestionOptionSchema).optional().catch(undefined).describe("Required for radio, checkbox, and select controls"),
  placeholder: z.string().optional().describe("Optional placeholder for text or textarea controls"),
  required: z.boolean().default(true).describe("Whether the user must answer this field"),
  help: z.string().optional().describe("Optional user-facing help text or source summary"),
  maxSelections: z.number().int().positive().optional().describe("Maximum selected options for checkbox controls"),
  source_task_id: z.string().optional().describe("Primary executor task ID that raised this question"),
  source_agent: LooseProductWorkflowAgentTypeSchema.optional().describe("Primary agent that raised this question"),
  sources: z.array(ProductWorkflowProposalQuestionSourceSchema).default([]).catch([]).describe("All executor sources covered by the same merged question"),
  priority: z.number().int().default(0).describe("Higher priority questions should be shown first"),
});

/**
 * 产品知识图谱结构化上下文，承载节点、关系、决策、风险、待确认问题及摘要等完整图谱快照。
 * markdown 字段可由结构化数据按需生成，不再作为主存储。
 */
export const ProductKnowledgeGraphSchema = z.object({
  entities: z.array(KnowledgeGraphEntitySchema),
  relations: z.array(KnowledgeGraphRelationSchema),
  decisions: z.array(KnowledgeGraphDecisionInputSchema).default([]),
  risks: z.array(KnowledgeGraphRiskInputSchema).default([]),
  open_questions: z.array(KnowledgeGraphOpenQuestionInputSchema).default([]),
  summary: z.array(z.string()).default([]),
  markdown: z.string().default(""),
  notes: z.array(z.string()).default([]),
});

/**
 * Planner 质量检查字段；兼容模型偶尔输出的简短字符串标准。
 */
const TaskQualityCheckSchema = z.union([
  z.object({
    status: z.enum(["pending", "passed", "failed"]),
    criteria: z.array(z.string().min(1)),
    result: z.string().optional(),
  }),
  z.string().min(1).transform((criteria) => ({
    status: "pending" as const,
    criteria: [criteria],
  })),
]);

/**
 * Planner DAG 边；兼容模型偶尔输出的 from/to 别名，解析后统一为 source/target。
 */
const TaskExecutionDagEdgeSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return {
    source: typeof record.source === "string" ? record.source : record.from,
    target: typeof record.target === "string" ? record.target : record.to,
  };
}, z.object({
  source: z.string().min(1).describe("Source task ID"),
  target: z.string().min(1).describe("Target task ID"),
}));

/**
 * Planner 假设项；兼容模型输出结构化 gap/assumption/impact 后统一压缩为字符串。
 */
const TaskExecutionAssumptionSchema = z.union([
  z.string().min(1),
  z.record(z.unknown()).transform(formatPlannerAssumptionRecord),
]);

/**
 * Planner Agent 生成的 DAG 节点，描述执行顺序、分配对象和验收标准。
 */
export const TaskExecutionNodeSchema = z.object({
  task_id: z.string().min(1),
  sequence: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().min(1),
  assigned_agent: ProductWorkflowAgentTypeSchema.exclude([
    "planner",
  ]),
  depends_on: z.array(z.string().min(1)),
  covered_business_model_indexes: z.array(z.number().int().positive()),
  expected_output: z.string().min(1),
  quality_check: TaskQualityCheckSchema,
});

/**
 * Planner Agent 写入 task_execution 的结构化计划。
 */
export const TaskExecutionPlanSchema = z.object({
  status: z.enum(["initial", "supplement"]).default("initial"),
  request_summary: z.string().min(1),
  dag: z.object({
    nodes: z.array(z.string().min(1)),
    edges: z.array(TaskExecutionDagEdgeSchema),
  }),
  tasks: z.array(TaskExecutionNodeSchema),
  assumptions: z.array(TaskExecutionAssumptionSchema).default([]),
});

/**
 * 将 Planner 输出的结构化假设记录压缩为现有运行时可持久化的字符串。
 */
function formatPlannerAssumptionRecord(record: Record<string, unknown>): string {
  const parts = [
    pickStringField(record, "gap_ref", "Gap"),
    pickStringField(record, "assumption", "Assumption"),
    pickStringField(record, "impact", "Impact"),
  ].filter((part) => part.length > 0);

  if (parts.length > 0) return parts.join(" | ");

  return JSON.stringify(record);
}

/**
 * 提取结构化假设字段，保留字段语义，避免降级为不可读 JSON。
 */
function pickStringField(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];
  return typeof value === "string" && value.trim()
    ? `${label}: ${value.trim()}`
    : "";
}

/**
 * Executor Agent 对单个任务的结构化产出。
 */
export const ExecutorAgentResultSchema = z.object({
  task_id: z.string().min(1),
  agent_type: ProductWorkflowAgentTypeSchema.exclude([
    "planner",
  ]),
  focus_layer: z.enum([
    "Goal",
    "Requirement",
    "Evidence",
    "Decision",
    "Feature",
    "Component",
    "Metric",
    "Custom",
  ]),
  summary: z.string().min(1),
  entities: z.array(KnowledgeGraphEntitySchema),
  relations: z.array(KnowledgeGraphRelationSchema),
  decisions: z.array(KnowledgeGraphDecisionInputSchema).default([]),
  risks: z.array(KnowledgeGraphRiskInputSchema).default([]),
  open_questions: z.array(KnowledgeGraphOpenQuestionInputSchema).default([]),
  quality_result: z.object({
    passed: z.boolean(),
    notes: z.string(),
  }),
  knowledge_graph_patch: z.string().optional(),
  knowledge_graph_markdown: z.string().optional(),
});

/**
 * Planner Agent 对完整 MVP 工作流的汇总与确认结果。
 */
export const ProductWorkflowResultSchema = z.object({
  status: z.enum(["pending_user_confirmation", "completed", "discarded"]),
  confirmation_id: z.string().min(1),
  request_summary: z.string().min(1),
  planner: TaskExecutionPlanSchema,
  executor_results: z.array(ExecutorAgentResultSchema),
  review: z.object({
    accepted_task_ids: z.array(z.string().min(1)),
    rejected_task_ids: z.array(z.string().min(1)),
    notes: z.string(),
  }),
  product_context_update: z.string().min(1),
  knowledge_graph_update: ProductKnowledgeGraphSchema,
  proposal_questions: z.array(ProductWorkflowProposalQuestionSchema).default([]),
  confirmation_message: z.string().min(1),
});

export type ProductWorkflowAgentType = z.infer<
  typeof ProductWorkflowAgentTypeSchema
>;
export type ProductKnowledgeGraph = z.infer<typeof ProductKnowledgeGraphSchema>;
export type TaskExecutionNode = z.infer<typeof TaskExecutionNodeSchema>;
export type TaskExecutionPlan = z.infer<typeof TaskExecutionPlanSchema>;
export type ExecutorAgentResult = z.infer<typeof ExecutorAgentResultSchema>;
export type ProductWorkflowResult = z.infer<typeof ProductWorkflowResultSchema>;
export type KnowledgeGraphEntity = z.infer<typeof KnowledgeGraphEntitySchema>;
export type KnowledgeGraphRelation = z.infer<
  typeof KnowledgeGraphRelationSchema
>;
export type KnowledgeGraphNodeInput = z.infer<
  typeof KnowledgeGraphNodeInputSchema
>;
export type KnowledgeGraphRelationInput = z.infer<
  typeof KnowledgeGraphRelationInputSchema
>;
export type KnowledgeGraphDecisionInput = z.infer<
  typeof KnowledgeGraphDecisionInputSchema
>;
export type KnowledgeGraphRiskInput = z.infer<
  typeof KnowledgeGraphRiskInputSchema
>;
export type KnowledgeGraphOpenQuestionInput = z.infer<
  typeof KnowledgeGraphOpenQuestionInputSchema
>;
export type ProductWorkflowProposalQuestion = z.infer<
  typeof ProductWorkflowProposalQuestionSchema
>;
