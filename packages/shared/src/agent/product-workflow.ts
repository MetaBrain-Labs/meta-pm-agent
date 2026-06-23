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
 * 占位产品知识图谱上下文，当前只承载已知节点与关系快照。
 */
export const ProductKnowledgeGraphSchema = z.object({
  entities: z.array(KnowledgeGraphEntitySchema),
  relations: z.array(KnowledgeGraphRelationSchema),
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
  decisions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
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
