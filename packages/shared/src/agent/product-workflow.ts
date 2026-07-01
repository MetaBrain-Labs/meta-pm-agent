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
});

/**
 * 结构化风险输入。
 */
export const KnowledgeGraphRiskInputSchema = z.object({
  id: z.string().min(1).describe("Risk ID, e.g. RISK-001"),
  text: z.string().min(1).describe("Risk description including impact and mitigation"),
});

/**
 * 结构化待确认问题输入。
 */
export const KnowledgeGraphOpenQuestionInputSchema = z.object({
  id: z.string().min(1).describe("Question ID, e.g. OQ-001"),
  text: z.string().min(1).describe("Question text explaining what needs to be confirmed"),
});

/**
 * Planner Agent 输出给 Conversation Agent 渲染的结构化 Question Form 问题。
 */
export const ProductWorkflowProposalQuestionSchema = z.object({
  id: z.string().min(1).describe("Stable field ID used in the submitted form answer"),
  label: z.string().min(1).describe("User-facing question label"),
  type: z.enum(["radio", "checkbox", "select", "text", "textarea"]).describe("Question Form control type chosen by Planner Agent"),
  options: z.array(z.string().min(1)).optional().describe("Required for radio, checkbox, and select controls"),
  placeholder: z.string().optional().describe("Optional placeholder for text or textarea controls"),
  required: z.boolean().default(true).describe("Whether the user must answer this field"),
  help: z.string().optional().describe("Optional user-facing help text or source summary"),
  maxSelections: z.number().int().positive().optional().describe("Maximum selected options for checkbox controls"),
  source_task_id: z.string().optional().describe("Primary executor task ID that raised this question"),
  source_agent: ProductWorkflowAgentTypeSchema.optional().describe("Primary agent that raised this question"),
  sources: z.array(
    z.object({
      source_task_id: z.string().min(1).describe("Executor task ID that raised this question"),
      source_agent: ProductWorkflowAgentTypeSchema.describe("Agent that raised this question"),
    }),
  ).default([]).describe("All executor sources covered by the same merged question"),
  priority: z.number().int().default(0).describe("Higher priority questions should be shown first"),
}).superRefine((question, ctx) => {
  if (
    ["radio", "checkbox", "select"].includes(question.type) &&
    (!question.options || question.options.length < 2)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["options"],
      message: "radio, checkbox, and select questions must include at least two options.",
    });
  }
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
    edges: z.array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
      }),
    ),
  }),
  tasks: z.array(TaskExecutionNodeSchema),
  assumptions: z.array(z.string()).default([]),
});

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
