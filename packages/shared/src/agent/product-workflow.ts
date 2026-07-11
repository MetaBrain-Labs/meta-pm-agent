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
  "orchestrator",
  "planner",
  "critique",
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
 * 归一化模型输出的 Agent 类型，避免局部来源字段写偏导致整个 Critique Agent 回退。
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

const ProductWorkflowProposalQuestionPrioritySchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === "high") return 3;
  if (normalized === "medium") return 2;
  if (normalized === "low") return 1;
  if (/^-?\d+$/.test(normalized)) return Number(normalized);
  return value;
}, z.number().int().default(0));

/**
 * 解析 Question Form 中常见的闭区间数字选项，用于阻止单选范围重叠。
 */
function parseProposalQuestionNumericInterval(
  option: string,
): { min: number; max: number } | null {
  const normalized = option
    .trim()
    .replace(/\s+/g, "")
    .replace(/[–—~～]/g, "-")
    .toLowerCase();
  const suffix = "(?:人|用户|个)?";
  const range = normalized.match(
    new RegExp(`^(\\d+(?:\\.\\d+)?)(?:-|至|到)(\\d+(?:\\.\\d+)?)${suffix}$`),
  );
  if (range) return { min: Number(range[1]), max: Number(range[2]) };

  const atMost = normalized.match(
    new RegExp(`^(?:≤|<=|不超过|最多|upto)(\\d+(?:\\.\\d+)?)${suffix}$`),
  ) ?? normalized.match(
    new RegExp(`^(\\d+(?:\\.\\d+)?)(?:及)?以下${suffix}$`),
  );
  if (atMost) return { min: Number.NEGATIVE_INFINITY, max: Number(atMost[1]) };

  const atLeast = normalized.match(
    new RegExp(`^(?:≥|>=|不少于|至少)(\\d+(?:\\.\\d+)?)${suffix}$`),
  ) ?? normalized.match(
    new RegExp(`^(\\d+(?:\\.\\d+)?)(?:及)?以上${suffix}$`),
  );
  if (atLeast) return { min: Number(atLeast[1]), max: Number.POSITIVE_INFINITY };

  const moreThan = normalized.match(
    new RegExp(`^(?:>|morethan)(\\d+)${suffix}$`),
  );
  if (moreThan) {
    return { min: Number(moreThan[1]) + 1, max: Number.POSITIVE_INFINITY };
  }

  return null;
}

/**
 * 判断单选数字区间是否存在共同边界或范围交叉。
 */
function hasOverlappingProposalQuestionIntervals(options: string[]): boolean {
  const intervals = options
    .map(parseProposalQuestionNumericInterval)
    .filter((interval): interval is { min: number; max: number } => Boolean(interval));

  return intervals.some((left, index) =>
    intervals.slice(index + 1).some(
      (right) => left.min <= right.max && right.min <= left.max,
    ),
  );
}

/**
 * Planner Agent 输出给 Conversation Agent 渲染的结构化 Question Form 问题。
 */
export const ProductWorkflowProposalQuestionSchema = z
  .object({
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
    priority: ProductWorkflowProposalQuestionPrioritySchema.describe("Integer priority; higher values are shown first"),
  })
  .superRefine((question, context) => {
    const isChoice =
      question.type === "radio" ||
      question.type === "select" ||
      question.type === "checkbox";
    if (isChoice && (!question.options || question.options.length < 2)) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Choice questions require at least two options",
      });
    }
    if (
      isChoice &&
      question.options &&
      new Set(question.options.map((option) => option.trim().toLowerCase())).size !==
        question.options.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Question options must be unique",
      });
    }
    if (
      (question.type === "radio" || question.type === "select") &&
      question.options &&
      hasOverlappingProposalQuestionIntervals(question.options)
    ) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Single-choice numeric ranges must not overlap",
      });
    }
    if (
      question.maxSelections !== undefined &&
      (question.type !== "checkbox" ||
        !question.options ||
        question.maxSelections > question.options.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxSelections"],
        message: "maxSelections is valid only for checkbox options and cannot exceed the option count",
      });
    }
  });

/**
 * 产品知识图谱结构化上下文，承载节点、关系、决策、风险、待确认问题及摘要等完整图谱快照。
 * markdown 字段可由结构化数据按需生成，不再作为主存储。
 */
export const ProductKnowledgeGraphSchema = z.object({
  current_state: z
    .enum(["initial", "building", "refining", "stable"])
    .optional()
    .describe("Current product context lifecycle state managed by the Orchestrator runtime"),
  description: z
    .string()
    .optional()
    .describe("Cumulative product context activity summary written by Orchestrator, Executor, and Critique agents"),
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
 * Planner 质量检查字段；兼容模型输出字符串、字符串数组或省略 status 的 criteria 对象。
 */
const TaskQualityCheckObjectSchema = z.object({
  status: z.enum(["pending", "passed", "failed"]),
  criteria: z.array(z.string().min(1)),
  result: z.string().optional(),
});

const TaskQualityCheckSchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return {
      status: "pending",
      criteria: value,
    };
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.criteria) && typeof record.status !== "string") {
      // Planner 经常只输出 criteria；运行时将其视为待验收状态。
      return {
        ...record,
        status: "pending",
      };
    }
  }

  return value;
}, z.union([
  TaskQualityCheckObjectSchema,
  z.string().min(1).transform((criteria) => ({
    status: "pending" as const,
    criteria: [criteria],
  })),
]));

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
 * Planner DAG；兼容模型偶发把 dag 直接输出为边数组的情况。
 */
const TaskExecutionDagSchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return {
      nodes: [],
      edges: value,
    };
  }

  return value;
}, z.object({
  nodes: z.array(z.string().min(1)).default([]),
  edges: z.array(TaskExecutionDagEdgeSchema),
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
    "orchestrator",
    "planner",
    "critique",
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
  dag: TaskExecutionDagSchema,
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
    "orchestrator",
    "planner",
    "critique",
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
export const ProductWorkflowReviewIssueSchema = z.object({
  code: z.string().min(1).describe("Stable machine-readable issue code"),
  severity: z
    .enum(["error", "warning"])
    .default("error")
    .catch("error")
    .describe("Issue severity"),
  task_id: z.preprocess(
    (value) => (value === null || value === "" ? undefined : value),
    z.string().optional().describe("Related planner task ID when applicable"),
  ),
  message: z.string().min(1).max(500).describe("Concise issue explanation"),
});

/**
 * 归一化 Critique Agent 的问题列表，将跨任务问题拆成单任务问题。
 */
const ProductWorkflowReviewIssuesSchema = z.preprocess((value) => {
  if (!Array.isArray(value)) return value;

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [item];

    const record = item as Record<string, unknown>;
    if (!Array.isArray(record.task_id)) return [item];

    const taskIds = [
      ...new Set(
        record.task_id.filter(
          (taskId): taskId is string =>
            typeof taskId === "string" && taskId.trim().length > 0,
        ),
      ),
    ];
    if (taskIds.length === 0) {
      const { task_id: _taskId, ...globalIssue } = record;
      return [globalIssue];
    }

    return taskIds.map((taskId) => ({ ...record, task_id: taskId }));
  });
}, z.array(ProductWorkflowReviewIssueSchema).default([]));

const ProductWorkflowReviewNotesSchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
      .slice(0, 8)
      .join("\n");
  }

  return value;
}, z.string().min(1).max(1200));

const ProductWorkflowKnowledgeGraphReviewNotesSchema = z.preprocess((value) => {
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return value;
}, z.array(z.string().min(1).max(500)).max(8).default([]));

/**
 * Critique Agent 引用的知识图谱快照标识。
 */
const ProductWorkflowKnowledgeGraphReviewRefSchema = z.preprocess((value) => {
  if (typeof value === "string" && value.trim()) {
    return { checksum: value.trim() };
  }

  return value;
}, z.object({
  version: z.number().int().nonnegative().optional().describe("Persisted graph version when known"),
  checksum: z.string().optional().describe("Optional checksum or stable graph reference"),
  entity_count: z.number().int().nonnegative().optional().describe("Final graph entity count"),
  relation_count: z.number().int().nonnegative().optional().describe("Final graph relation count"),
}));

/**
 * Critique Agent 对最终知识图谱状态的轻量审查结论。
 */
export const ProductWorkflowKnowledgeGraphReviewSchema = z.object({
  graph_ref: ProductWorkflowKnowledgeGraphReviewRefSchema.optional().describe("Reference to the graph snapshot reviewed by Critique Agent"),
  accepted_task_ids: z.array(z.string().min(1)).default([]).describe("Task IDs whose graph updates are accepted"),
  rejected_task_ids: z.array(z.string().min(1)).default([]).describe("Task IDs whose graph updates are rejected"),
  retry_task_ids: z.array(z.string().min(1)).default([]).describe("Task IDs that should be retried or corrected"),
  issues: ProductWorkflowReviewIssuesSchema.describe("Detected graph or execution issues"),
  notes: ProductWorkflowKnowledgeGraphReviewNotesSchema.describe("Short review notes; never repeat full graph data"),
});

/**
 * Critique Agent 模型的瘦身输出契约。
 *
 * 模型只输出审查结论、用户补充问题和短摘要；Planner DAG、Executor 结果和完整知识图谱
 * 由运行时代码按已有状态组合，不再要求模型复制。
 */
export const CritiqueAgentOutputSchema = z.object({
  status: z.enum([
    "pending_user_confirmation",
    "completed",
    "requires_executor_retry",
  ]).describe("Review outcome"),
  confirmation_id: z.string().min(1).describe("Stable question-form ID"),
  request_summary: z.string().min(1).max(500).describe("Concise request summary"),
  review: z.object({
    accepted_task_ids: z.array(z.string().min(1)).describe("Accepted task IDs"),
    rejected_task_ids: z.array(z.string().min(1)).describe("Rejected task IDs"),
    retry_task_ids: z.array(z.string().min(1)).default([]).describe("Task IDs that require retry or correction"),
    issues: ProductWorkflowReviewIssuesSchema.describe("Detected issues"),
    notes: ProductWorkflowReviewNotesSchema.describe("Compact review notes"),
  }).describe("Critique Agent decision"),
  product_context_update: z.string().min(1).max(1200).describe("Short product context update summary"),
  knowledge_graph_review: ProductWorkflowKnowledgeGraphReviewSchema.describe("Lightweight graph review, not the full graph"),
  proposal_questions: z.array(ProductWorkflowProposalQuestionSchema).max(3).default([]).describe("At most three high-priority user questions"),
  confirmation_message: z.string().min(1).max(500).describe("Concise user-facing confirmation message"),
});

/**
 * 历史兼容别名：旧代码和持久化恢复仍可引用 PlannerWorkflowReviewOutputSchema。
 */
export const PlannerWorkflowReviewOutputSchema = CritiqueAgentOutputSchema;

/**
 * 产品工作流的运行时汇总结果。
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
    retry_task_ids: z.array(z.string().min(1)).optional(),
    issues: z.array(ProductWorkflowReviewIssueSchema).optional(),
    notes: z.string(),
  }),
  product_context_update: z.string().min(1),
  knowledge_graph_update: ProductKnowledgeGraphSchema,
  knowledge_graph_review: ProductWorkflowKnowledgeGraphReviewSchema.optional(),
  proposal_questions: z.array(ProductWorkflowProposalQuestionSchema).default([]),
  confirmation_message: z.string().min(1),
});

/**
 * Orchestrator Agent 的项目意图分类。
 */
export const OrchestratorIntentSchema = z.enum([
  "casual_chat",
  "new_project",
  "project_evolution",
]);

/**
 * Orchestrator Agent 使用的产品上下文来源标识。
 */
export const OrchestratorContextSourceSchema = z.enum([
  "resources",
  "database",
  "product_knowledge_graph",
  "none",
]);

/**
 * Orchestrator Agent 的路由决策。
 *
 * 该结构只表达顶层编排意图，不承载 Planner DAG。真正的 DAG 仍由 Planner Agent
 * 通过现有 TaskExecutionPlanSchema 生成并归一化。
 */
export const OrchestratorAgentResultSchema = z.object({
  intent: OrchestratorIntentSchema.describe(
    "Top-level user intent for this turn.",
  ),
  route: z.enum(["conversation", "product_workflow"]).describe(
    "Next runtime route selected by Orchestrator.",
  ),
  plan_type: z.enum(["initial", "supplement"]).optional().describe(
    "Planner mode when route is product_workflow.",
  ),
  context_source: OrchestratorContextSourceSchema.describe(
    "Where the current project context was loaded from.",
  ),
  has_project_context: z.boolean().describe(
    "Whether any meaningful project graph context is available.",
  ),
  reason_summary: z.string().min(1).max(800).describe(
    "Compact explanation of the routing decision for runtime logs.",
  ),
  planner_delegation_summary: z.string().max(1200).optional().describe(
    "Optional summary returned after delegating planning readiness to the Planner subagent.",
  ),
  warnings: z.array(z.string().min(1)).default([]).describe(
    "Operational warnings that should be logged but not shown as stack traces.",
  ),
});

export type ProductWorkflowAgentType = z.infer<
  typeof ProductWorkflowAgentTypeSchema
>;
export type OrchestratorIntent = z.infer<typeof OrchestratorIntentSchema>;
export type OrchestratorContextSource = z.infer<
  typeof OrchestratorContextSourceSchema
>;
export type OrchestratorAgentResult = z.infer<
  typeof OrchestratorAgentResultSchema
>;
export type ProductKnowledgeGraph = z.infer<typeof ProductKnowledgeGraphSchema>;
export type TaskExecutionNode = z.infer<typeof TaskExecutionNodeSchema>;
export type TaskExecutionPlan = z.infer<typeof TaskExecutionPlanSchema>;
export type ExecutorAgentResult = z.infer<typeof ExecutorAgentResultSchema>;
export type ProductWorkflowResult = z.infer<typeof ProductWorkflowResultSchema>;
export type CritiqueAgentOutput = z.infer<typeof CritiqueAgentOutputSchema>;
export type PlannerWorkflowReviewOutput = CritiqueAgentOutput;
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
