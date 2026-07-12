/**
 * Critique Agent 实现
 *
 * 独立承载 Critique Agent 的模型调用、审查输入构造、确定性校验、
 * fallback 审查结果与 ProductWorkflowResult 组合逻辑。
 *
 * Responsibilities:
 * - streamCritiqueAgent()：汇总 Executor 结果并生成工作流审查结论
 * - 构造 compact review payload，避免模型复制完整 DAG、Executor 结果或知识图谱
 * - 在模型不可用时生成可恢复的 deterministic fallback review
 *
 * Notes:
 * - agentType 使用 critique，让 SSE 和前端可以展示独立的 Critique Agent 阶段
 */
import {
  CritiqueAgentOutputSchema,
  type ExecutorAgentResult,
  type CritiqueAgentOutput,
  type KnowledgeGraphEntity,
  type KnowledgeGraphRelation,
  type ProductKnowledgeGraph,
  type ProductWorkflowProposalQuestion,
  type ProductWorkflowResult,
  type TaskExecutionPlan,
} from "@repo/shared";
import {
  JSON_AGENT_MODEL_OPTIONS,
  runJsonAgent,
} from "../../common/run-json-agent";
import type {
  CritiqueAgentInput,
  ProductWorkflowStreamEvent,
} from "../types";
import { isKnowledgeGraphRelationDirectionValid } from "../common/knowledge-graph";
import { areKnowledgeGraphItemsSimilar } from "../common/knowledge-graph-merge";
import {
  getExecutorDefinition,
  isExecutorAgentType,
  type ExecutorAgentType,
} from "../executor-agent/definitions";
import { CRITIQUE_AGENT_PROMPT } from "./prompt";

/**
 * Critique Agent：在 Executor 全部完成后审查工作流结果并生成用户确认数据。
 */
export async function* streamCritiqueAgent(
  input: CritiqueAgentInput,
): AsyncGenerator<ProductWorkflowStreamEvent, ProductWorkflowResult, void> {
  const review = yield* runJsonAgent({
    agentType: "critique",
    agentLabel: "Critique Agent",
    name: "critique-agent",
    modelOptions: {
      ...JSON_AGENT_MODEL_OPTIONS,
      maxTokens: 16384,
    },
    systemPrompt: CRITIQUE_AGENT_PROMPT,
    payload: createCritiqueAgentPayload(input),
    schema: CritiqueAgentOutputSchema,
    fallback: (reason) => createFallbackCritiqueAgentOutput(input, reason),
    signal: input.signal,
  });

  return composeProductWorkflowResult(input, review);
}

/**
 * Critique Agent 的确定性校验问题。
 */
type CritiqueValidationIssue =
  CritiqueAgentOutput["review"]["issues"][number];

/**
 * 单个 Executor 图谱提交记录，供 Critique Agent 判断是否可接受。
 */
type ExecutorUpdateRecord = {
  task_id: string;
  assigned_agent: string;
  actual_agent: string | null;
  status: "completed" | "missing";
  created_entity_ids: string[];
  created_relation_ids: string[];
  committed_entity_ids: string[];
  committed_relation_ids: string[];
  commit_status:
    | "committed"
    | "partial"
    | "not_committed"
    | "not_attempted";
  validation_errors: CritiqueValidationIssue[];
};

/**
 * Critique Agent 输入中的确定性校验报告。
 */
type CritiqueValidationReport = {
  accepted_task_ids: string[];
  rejected_task_ids: string[];
  retry_task_ids: string[];
  issues: CritiqueValidationIssue[];
  executor_update_records: ExecutorUpdateRecord[];
  graph_integrity: {
    dangling_relation_ids: string[];
    invalid_direction_relation_ids: string[];
    orphan_requirement_ids: string[];
    orphan_feature_ids: string[];
  };
};

/**
 * 构造 Critique Agent 的瘦身输入，避免把完整 DAG、Executor 结果和知识图谱交给模型复制。
 */
function createCritiqueAgentPayload(input: CritiqueAgentInput) {
  const validationReport = createCritiqueValidationReport(input);

  return {
    product_context: truncateText(
      input.productContext || "No product context provided.",
      800,
    ),
    request_analysis: compactRequestAnalysisForReview(input.requestAnalysis),
    user_input: (input.userInput ?? []).map((item) => ({
      index: item.index,
      type: item.type,
      content: truncateText(item.content, 300),
    })),
    planner_summary: compactPlanForReview(input.plan),
    final_graph_summary: createFinalGraphSummary(input.knowledgeGraph),
    task_semantic_updates: compactTaskSemanticUpdates(input.executorResults),
    validation_report: validationReport,
    open_question_candidates: collectOpenQuestionCandidates(
      input.executorResults,
    ),
  };
}

/**
 * 压缩 Request Agent 分析，只保留 Critique 判断需要的目标、约束和缺口。
 */
function compactRequestAnalysisForReview(
  analysis: CritiqueAgentInput["requestAnalysis"],
) {
  return {
    business_model: analysis.business_model.map((item) => ({
      index: item.index,
      user_goal: truncateText(item.user_goal, 220),
      goal_constraints: item.goal_constraints.map((constraint) =>
        truncateText(constraint, 160),
      ),
      missing_information: item.missing_information.map((info) => ({
        index: info.index,
        description: truncateText(info.description, 180),
        importance: info.importance,
      })),
      covered_user_input_indexes: item.covered_user_input_indexes,
    })),
    questions: analysis.questions,
    chitchat: analysis.chitchat,
  };
}

/**
 * 压缩 Planner DAG，只保留任务身份、依赖、分配和验收摘要。
 */
function compactPlanForReview(plan: TaskExecutionPlan) {
  return {
    status: plan.status,
    request_summary: truncateText(plan.request_summary, 220),
    task_ids: plan.tasks.map((task) => task.task_id),
    dag: plan.dag,
    tasks: plan.tasks.map((task) => ({
      task_id: task.task_id,
      title: truncateText(task.title, 120),
      assigned_agent: task.assigned_agent,
      depends_on: task.depends_on,
      covered_business_model_indexes: task.covered_business_model_indexes,
      expected_output: truncateText(task.expected_output, 180),
      required_open_question_count:
        task.required_open_question_count ??
        task.required_open_question_ids?.length ??
        0,
    })),
  };
}

/**
 * 仅传递本轮 Executor 新增内容，避免 Critique 读取完整图谱仍能进行语义审查。
 */
export function compactTaskSemanticUpdates(
  executorResults: ExecutorAgentResult[],
) {
  return executorResults.map((result) => ({
    task_id: result.task_id,
    agent_type: result.agent_type,
    summary: truncateText(result.summary, 240),
    entities: result.entities.map((entity) => ({
      id: entity.id,
      type: entity.type,
      name: truncateText(entity.name, 120),
      description: entity.description
        ? truncateText(entity.description, 280)
        : undefined,
      status: entity.status,
    })),
    relations: result.relations.map((relation) => ({
      id: relation.id,
      type: relation.type,
      source: relation.source,
      target: relation.target,
      description: relation.description
        ? truncateText(relation.description, 180)
        : undefined,
    })),
    decisions: result.decisions.map((decision) => ({
      ...decision,
      text: truncateText(decision.text, 240),
    })),
    risks: result.risks.map((risk) => ({
      ...risk,
      text: truncateText(risk.text, 240),
    })),
  }));
}

/**
 * 生成最终图谱的统计摘要和来源索引，避免模型读取完整节点描述。
 */
function createFinalGraphSummary(knowledgeGraph: ProductKnowledgeGraph) {
  return {
    graph_ref: createKnowledgeGraphReviewRef(knowledgeGraph),
    entity_counts: countBy(knowledgeGraph.entities.map((item) => item.type)),
    relation_counts: countBy(knowledgeGraph.relations.map((item) => item.type)),
    decision_count: knowledgeGraph.decisions.length,
    risk_count: knowledgeGraph.risks.length,
    open_question_count: knowledgeGraph.open_questions.length,
    entity_ids_by_task: groupIdsBySourceTask(knowledgeGraph.entities),
    relation_ids_by_task: groupIdsBySourceTask(knowledgeGraph.relations),
  };
}

/**
 * 生成图谱引用信息；当前运行时无持久化版本号时以规模摘要作为稳定引用。
 */
function createKnowledgeGraphReviewRef(knowledgeGraph: ProductKnowledgeGraph) {
  return {
    entity_count: knowledgeGraph.entities.length,
    relation_count: knowledgeGraph.relations.length,
  };
}

/**
 * 统计字符串枚举出现次数。
 */
function countBy(items: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item] = (counts[item] ?? 0) + 1;
  }
  return counts;
}

/**
 * 按来源任务聚合图谱 ID，辅助 Review 判断任务提交是否落图。
 */
function groupIdsBySourceTask<
  T extends { id: string; source_task_id?: string },
>(items: T[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const item of items) {
    const key = item.source_task_id ?? "unknown-task";
    groups[key] = [...(groups[key] ?? []), item.id];
  }
  return groups;
}

/**
 * 收集 Executor 提出的待确认问题候选，交给 Critique Agent 做语义合并和优先级判断。
 */
function collectOpenQuestionCandidates(executorResults: ExecutorAgentResult[]) {
  const candidates = new Map<
    string,
    {
      id: string;
      text: string;
      source_task_id: string;
      source_agent: ExecutorAgentResult["agent_type"];
      sources: Array<{
        source_task_id: string;
        source_agent: ExecutorAgentResult["agent_type"];
        open_question_id: string;
      }>;
      priority_hint: number;
    }
  >();

  for (const result of executorResults) {
    result.open_questions.forEach((question, index) => {
      const key = normalizeFallbackQuestionText(question.text);
      if (!key) return;

      const source = {
        source_task_id: result.task_id,
        source_agent: result.agent_type,
        open_question_id: question.id,
      };
      const priority = question.blocking
        ? 100 - index
        : 50 - index;
      const existing = candidates.get(key);
      if (existing) {
        existing.sources = mergeFallbackQuestionSources([
          ...existing.sources,
          source,
        ]);
        existing.priority_hint = Math.max(existing.priority_hint, priority);
        return;
      }

      candidates.set(key, {
        id: question.id,
        text: truncateText(question.text, 240),
        ...source,
        sources: [source],
        priority_hint: priority,
      });
    });
  }

  return [...candidates.values()].sort(
    (left, right) => right.priority_hint - left.priority_hint,
  );
}

/**
 * 生成确定性校验报告，把可由程序判断的错误移出 LLM。
 */
export function createCritiqueValidationReport(
  input: CritiqueAgentInput,
): CritiqueValidationReport {
  const resultByTaskId = new Map(
    input.executorResults.map((result) => [result.task_id, result]),
  );
  const graphIndexes = createGraphIndexes(input.knowledgeGraph);
  const graphIntegrity = inspectGraphIntegrity(input.knowledgeGraph);
  const issues: CritiqueValidationIssue[] = [];
  const records: ExecutorUpdateRecord[] = [];

  for (const task of input.plan.tasks) {
    const result = resultByTaskId.get(task.task_id);
    const taskIssues: CritiqueValidationIssue[] = [];

    if (!result) {
      taskIssues.push(
        createReviewIssue({
          code: "MISSING_EXECUTOR_RESULT",
          severity: "error",
          taskId: task.task_id,
          message: "Planned task has no executor result.",
        }),
      );
      records.push({
        task_id: task.task_id,
        assigned_agent: task.assigned_agent,
        actual_agent: null,
        status: "missing",
        created_entity_ids: [],
        created_relation_ids: [],
        committed_entity_ids: [],
        committed_relation_ids: [],
        commit_status: "not_attempted",
        validation_errors: taskIssues,
      });
      issues.push(...taskIssues);
      continue;
    }

    if (result.agent_type !== task.assigned_agent) {
      taskIssues.push(
        createReviewIssue({
          code: "AGENT_TYPE_MISMATCH",
          severity: "error",
          taskId: task.task_id,
          message: `Task assigned to ${task.assigned_agent} but result came from ${result.agent_type}.`,
        }),
      );
    }

    if (isExecutorAgentType(task.assigned_agent)) {
      taskIssues.push(
        ...validateExecutorBoundaries(result, task.assigned_agent),
      );
    }

    // Planner 的规模上限是软门禁：超出时保留结果，但要求 Critique 明确提示。
    if (result.entities.length > 8 || result.relations.length > 12) {
      taskIssues.push(
        createReviewIssue({
          code: "TASK_PATCH_SIZE_EXCEEDED",
          severity: "warning",
          taskId: task.task_id,
          message: `Task created ${result.entities.length} entities and ${result.relations.length} relations; the normal ceiling is 8 entities and 12 relations.`,
        }),
      );
    }

    const blockingQuestionCount = result.open_questions.filter(
      (question) => question.blocking,
    ).length;
    const requiredBlockingQuestionCount =
      task.required_open_question_count ??
      task.required_open_question_ids?.length ??
      0;
    if (blockingQuestionCount < requiredBlockingQuestionCount) {
      taskIssues.push(
        createReviewIssue({
          code: "MISSING_REQUIRED_BLOCKING_QUESTIONS",
          severity: "error",
          taskId: task.task_id,
          message: `Task persisted ${blockingQuestionCount} blocking OpenQuestions but requires ${requiredBlockingQuestionCount}.`,
        }),
      );
    }

    const commit = validateExecutorCommit(result, graphIndexes);
    taskIssues.push(...commit.issues);

    const commitStatus = getExecutorCommitStatus({
      result,
      committedItemCount: commit.committedItemCount,
      totalItemCount: commit.totalItemCount,
    });

    records.push({
      task_id: result.task_id,
      assigned_agent: task.assigned_agent,
      actual_agent: result.agent_type,
      status: "completed",
      created_entity_ids: result.entities.map((item) => item.id),
      created_relation_ids: result.relations.map((item) => item.id),
      committed_entity_ids: commit.committedEntityIds,
      committed_relation_ids: commit.committedRelationIds,
      commit_status: commitStatus,
      validation_errors: taskIssues,
    });
    issues.push(...taskIssues);
  }

  const currentRelationTaskById = new Map(
    records.flatMap((record) =>
      record.committed_relation_ids.map(
        (relationId) => [relationId, record.task_id] as const,
      ),
    ),
  );
  const graphIssues = createGraphIntegrityIssues(
    input.knowledgeGraph,
    graphIntegrity,
    currentRelationTaskById,
  );
  for (const issue of graphIssues) {
    issues.push(issue);
    if (!issue.task_id) continue;

    const record = records.find((item) => item.task_id === issue.task_id);
    if (!record) continue;
    record.validation_errors.push(issue);
  }

  const semanticQualityIssues = createSemanticQualityIssues(input);
  for (const issue of semanticQualityIssues) {
    issues.push(issue);
    if (!issue.task_id) continue;
    records
      .find((record) => record.task_id === issue.task_id)
      ?.validation_errors.push(issue);
  }

  const issueTaskIds = new Set(
    issues
      .filter((issue) => issue.severity === "error" && issue.task_id)
      .map((issue) => issue.task_id!),
  );
  const acceptedTaskIds = input.plan.tasks
    .map((task) => task.task_id)
    .filter((taskId) => !issueTaskIds.has(taskId));
  const rejectedTaskIds = [...issueTaskIds];

  return {
    accepted_task_ids: acceptedTaskIds,
    rejected_task_ids: rejectedTaskIds,
    retry_task_ids: rejectedTaskIds,
    issues,
    executor_update_records: records,
    graph_integrity: graphIntegrity,
  };
}

/**
 * 对适合程序判断的语义质量问题增加软门禁，不把启发式结果升级为重试错误。
 */
function createSemanticQualityIssues(
  input: CritiqueAgentInput,
): CritiqueValidationIssue[] {
  const issues: CritiqueValidationIssue[] = [];
  const currentTaskIds = new Set(input.plan.tasks.map((task) => task.task_id));
  const metrics = input.knowledgeGraph.entities.filter(
    (entity) => entity.type === "Metric",
  );
  const duplicatePairs = new Set<string>();

  for (let leftIndex = 0; leftIndex < metrics.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < metrics.length; rightIndex += 1) {
      const left = metrics[leftIndex]!;
      const right = metrics[rightIndex]!;
      if (!areKnowledgeGraphItemsSimilar(left, right, "entity")) continue;

      const sourceTaskId = currentTaskIds.has(right.source_task_id ?? "")
        ? right.source_task_id
        : currentTaskIds.has(left.source_task_id ?? "")
          ? left.source_task_id
          : null;
      if (!sourceTaskId) continue;

      const pairKey = [left.id, right.id].sort().join("|");
      if (duplicatePairs.has(pairKey)) continue;
      duplicatePairs.add(pairKey);
      issues.push(
        createReviewIssue({
          code: "DUPLICATE_METRIC",
          severity: "warning",
          taskId: sourceTaskId,
          message: `Metrics ${left.id} and ${right.id} appear semantically duplicated; consolidate them or clarify distinct measurement scopes.`,
        }),
      );
    }
  }

  for (const evidence of input.knowledgeGraph.entities) {
    if (
      evidence.type !== "Evidence" ||
      !currentTaskIds.has(evidence.source_task_id ?? "")
    ) {
      continue;
    }
    const consumed = input.knowledgeGraph.relations.some(
      (relation) =>
        relation.source === evidence.id &&
        ["Validates", "References"].includes(relation.type),
    );
    if (consumed) continue;

    issues.push(
      createReviewIssue({
        code: "UNCONSUMED_EVIDENCE",
        severity: "warning",
        taskId: evidence.source_task_id!,
        message: `Evidence ${evidence.id} is not consumed by a Validates or References relation.`,
      }),
    );
  }

  return issues;
}

/**
 * 确定性校验 Executor 是否越过其实体和关系类型边界。
 */
function validateExecutorBoundaries(
  result: ExecutorAgentResult,
  assignedAgent: ExecutorAgentType,
): CritiqueValidationIssue[] {
  const definition = getExecutorDefinition(assignedAgent);
  const unauthorizedEntityTypes = [
    ...new Set(
      result.entities
        .map((entity) => entity.type)
        .filter(
          (entityType) =>
            !definition.allowedEntityTypes.some(
              (allowedType) => allowedType === entityType,
            ),
        ),
    ),
  ];
  const unauthorizedRelationTypes = [
    ...new Set(
      result.relations
        .map((relation) => relation.type)
        .filter(
          (relationType) =>
            relationType !== "Custom" &&
            !definition.allowedRelationTypes.some(
              (allowedType) => allowedType === relationType,
            ),
        ),
    ),
  ];

  return [
    ...unauthorizedEntityTypes.map((entityType) =>
      createReviewIssue({
        code: "UNAUTHORIZED_ENTITY_TYPE",
        severity: "error",
        taskId: result.task_id,
        message: `${assignedAgent} is not allowed to create ${entityType} entities.`,
      }),
    ),
    ...unauthorizedRelationTypes.map((relationType) =>
      createReviewIssue({
        code: "UNAUTHORIZED_RELATION_TYPE",
        severity: "error",
        taskId: result.task_id,
        message: `${assignedAgent} is not allowed to create ${relationType} relations.`,
      }),
    ),
  ];
}

/**
 * 检查最终图谱中可确定判断的端点、关系方向和孤立节点。
 */
function inspectGraphIntegrity(
  knowledgeGraph: ProductKnowledgeGraph,
): CritiqueValidationReport["graph_integrity"] {
  const entityById = new Map(
    knowledgeGraph.entities.map((entity) => [entity.id, entity]),
  );
  const connectedEntityIds = new Set<string>();
  const danglingRelationIds: string[] = [];
  const invalidDirectionRelationIds: string[] = [];

  for (const relation of knowledgeGraph.relations) {
    const source = entityById.get(relation.source);
    const target = entityById.get(relation.target);
    if (!source || !target) {
      danglingRelationIds.push(relation.id);
      continue;
    }

    connectedEntityIds.add(source.id);
    connectedEntityIds.add(target.id);
    if (
      !isKnowledgeGraphRelationDirectionValid(
        relation.type,
        source.type,
        target.type,
      )
    ) {
      invalidDirectionRelationIds.push(relation.id);
    }
  }

  return {
    dangling_relation_ids: danglingRelationIds,
    invalid_direction_relation_ids: invalidDirectionRelationIds,
    orphan_requirement_ids: knowledgeGraph.entities
      .filter(
        (entity) =>
          entity.type === "Requirement" &&
          entity.status !== "deprecated" &&
          !connectedEntityIds.has(entity.id),
      )
      .map((entity) => entity.id),
    orphan_feature_ids: knowledgeGraph.entities
      .filter(
        (entity) =>
          entity.type === "Feature" &&
          entity.status !== "deprecated" &&
          !connectedEntityIds.has(entity.id),
      )
      .map((entity) => entity.id),
  };
}

/**
 * 将全图完整性结果转换为 Critique 和 fallback 共用的机器可读问题。
 */
function createGraphIntegrityIssues(
  knowledgeGraph: ProductKnowledgeGraph,
  integrity: CritiqueValidationReport["graph_integrity"],
  currentRelationTaskById: Map<string, string>,
): CritiqueValidationIssue[] {
  const relationById = new Map(
    knowledgeGraph.relations.map((relation) => [relation.id, relation]),
  );
  const entityById = new Map(
    knowledgeGraph.entities.map((entity) => [entity.id, entity]),
  );
  const issues: CritiqueValidationIssue[] = [];

  for (const relationId of integrity.dangling_relation_ids) {
    const relation = relationById.get(relationId);
    const currentTaskId = currentRelationTaskById.get(relationId);
    issues.push(
      createReviewIssue({
        code: currentTaskId
          ? "RELATION_ENDPOINT_MISSING"
          : "LEGACY_RELATION_ENDPOINT_MISSING",
        severity: currentTaskId ? "error" : "warning",
        taskId: currentTaskId,
        message: `${currentTaskId ? "Relation" : "Existing graph relation"} ${relationId} references a missing source or target node.`,
      }),
    );
  }

  for (const relationId of integrity.invalid_direction_relation_ids) {
    const relation = relationById.get(relationId);
    const currentTaskId = currentRelationTaskById.get(relationId);
    const sourceType = relation
      ? entityById.get(relation.source)?.type
      : undefined;
    const targetType = relation
      ? entityById.get(relation.target)?.type
      : undefined;
    issues.push(
      createReviewIssue({
        code: currentTaskId
          ? "INVALID_RELATION_DIRECTION"
          : "LEGACY_INVALID_RELATION_DIRECTION",
        severity: currentTaskId ? "error" : "warning",
        taskId: currentTaskId,
        message: `${currentTaskId ? "Relation" : "Existing graph relation"} ${relationId} uses invalid direction ${sourceType ?? "missing"} --${relation?.type ?? "unknown"}--> ${targetType ?? "missing"}.`,
      }),
    );
  }

  if (integrity.orphan_requirement_ids.length > 0) {
    issues.push(
      createReviewIssue({
        code: "ORPHAN_REQUIREMENT",
        severity: "warning",
        message: `Requirement nodes have no relations: ${formatCompactIdList(integrity.orphan_requirement_ids)}.`,
      }),
    );
  }
  if (integrity.orphan_feature_ids.length > 0) {
    issues.push(
      createReviewIssue({
        code: "ORPHAN_FEATURE",
        severity: "warning",
        message: `Feature nodes have no relations: ${formatCompactIdList(integrity.orphan_feature_ids)}.`,
      }),
    );
  }

  return issues;
}

/**
 * 压缩问题中的 ID 列表，避免图谱异常时放大 Critique 输入。
 */
function formatCompactIdList(ids: string[]): string {
  return `${ids.slice(0, 8).join(", ")}${ids.length > 8 ? ` and ${ids.length - 8} more` : ""}`;
}

/**
 * 创建按 ID 查询的图谱索引。
 */
function createGraphIndexes(knowledgeGraph: ProductKnowledgeGraph) {
  return {
    entities: knowledgeGraph.entities,
    relations: knowledgeGraph.relations,
    decisions: knowledgeGraph.decisions,
    risks: knowledgeGraph.risks,
    openQuestions: knowledgeGraph.open_questions,
    entityById: new Map(knowledgeGraph.entities.map((item) => [item.id, item])),
    relationById: new Map(
      knowledgeGraph.relations.map((item) => [item.id, item]),
    ),
    decisionById: new Map(
      knowledgeGraph.decisions.map((item) => [item.id, item]),
    ),
    riskById: new Map(knowledgeGraph.risks.map((item) => [item.id, item])),
    openQuestionById: new Map(
      knowledgeGraph.open_questions.map((item) => [item.id, item]),
    ),
  };
}

/**
 * 校验 Executor 结构化产出是否真的存在于最终图谱状态。
 */
function validateExecutorCommit(
  result: ExecutorAgentResult,
  graphIndexes: ReturnType<typeof createGraphIndexes>,
): {
  issues: CritiqueValidationIssue[];
  committedEntityIds: string[];
  committedRelationIds: string[];
  committedItemCount: number;
  totalItemCount: number;
} {
  const issues: CritiqueValidationIssue[] = [];
  const committedEntityIds: string[] = [];
  const committedRelationIds: string[] = [];
  const entityIdMap = new Map<string, string>();
  let committedItemCount = 0;
  const totalItemCount =
    result.entities.length +
    result.relations.length +
    result.decisions.length +
    result.risks.length +
    result.open_questions.length;

  for (const entity of result.entities) {
    const committed = findCommittedEntity(
      entity,
      result.task_id,
      graphIndexes,
    );
    if (!committed) {
      issues.push(
        createReviewIssue({
          code: "ENTITY_NOT_COMMITTED",
          severity: "error",
          taskId: result.task_id,
          message: `Entity ${entity.id} exists in executor output but not in final graph.`,
        }),
      );
      continue;
    }
    entityIdMap.set(entity.id, committed.id);
    committedEntityIds.push(committed.id);
    committedItemCount += 1;
  }

  for (const relation of result.relations) {
    const committed = findCommittedRelation(
      relation,
      result.task_id,
      graphIndexes,
      entityIdMap,
    );
    if (!committed) {
      issues.push(
        createReviewIssue({
          code: "RELATION_NOT_COMMITTED",
          severity: "error",
          taskId: result.task_id,
          message: `Relation ${relation.id} exists in executor output but not in final graph.`,
        }),
      );
      continue;
    }
    committedRelationIds.push(committed.id);
    committedItemCount += 1;
  }

  committedItemCount += countCommittedAuxiliaryItems(result, graphIndexes);

  if (totalItemCount === 0) {
    issues.push(
      createReviewIssue({
        code: "NO_STRUCTURED_GRAPH_PATCH",
        severity: "error",
        taskId: result.task_id,
        message: "Executor result contains no structured graph patch items.",
      }),
    );
  }

  return {
    issues,
    committedEntityIds,
    committedRelationIds,
    committedItemCount,
    totalItemCount,
  };
}

/**
 * 在最终图谱中寻找 Executor 实体的落图结果，兼容相似去重和冲突重编号。
 */
function findCommittedEntity(
  entity: KnowledgeGraphEntity,
  taskId: string,
  graphIndexes: ReturnType<typeof createGraphIndexes>,
): KnowledgeGraphEntity | null {
  const exact = graphIndexes.entityById.get(entity.id);
  if (exact && areKnowledgeGraphItemsSimilar(entity, exact, "entity")) {
    return exact;
  }

  const expectedSource = entity.source_task_id ?? taskId;
  return (
    graphIndexes.entities.find(
      (candidate) =>
        candidate.id !== entity.id &&
        candidate.source_task_id === expectedSource &&
        areKnowledgeGraphItemsSimilar(entity, candidate, "entity"),
    ) ?? null
  );
}

/**
 * 在最终图谱中寻找 Executor 关系的落图结果，并应用实体重编号映射。
 */
function findCommittedRelation(
  relation: KnowledgeGraphRelation,
  taskId: string,
  graphIndexes: ReturnType<typeof createGraphIndexes>,
  entityIdMap: Map<string, string>,
): KnowledgeGraphRelation | null {
  const remappedRelation = remapRelationForCommit(relation, entityIdMap);
  const exact = graphIndexes.relationById.get(relation.id);
  if (
    exact &&
    areKnowledgeGraphItemsSimilar(remappedRelation, exact, "relation")
  ) {
    return exact;
  }

  const expectedSource = relation.source_task_id ?? taskId;
  return (
    graphIndexes.relations.find(
      (candidate) =>
        candidate.id !== relation.id &&
        candidate.source_task_id === expectedSource &&
        areKnowledgeGraphItemsSimilar(
          remappedRelation,
          candidate,
          "relation",
        ),
    ) ?? null
  );
}

/**
 * 将 Executor 原始关系端点映射到最终图谱中的实体 ID。
 */
function remapRelationForCommit(
  relation: KnowledgeGraphRelation,
  entityIdMap: Map<string, string>,
): KnowledgeGraphRelation {
  return {
    ...relation,
    source: entityIdMap.get(relation.source) ?? relation.source,
    target: entityIdMap.get(relation.target) ?? relation.target,
  };
}

/**
 * 在最终图谱中寻找决策、风险、开放问题等辅助项的落图结果。
 */
function findCommittedAuxiliaryItem<
  T extends { id: string; text: string; source_task_id?: string },
>(
  item: T,
  taskId: string,
  candidates: T[],
  byId: Map<string, T>,
): T | null {
  const exact = byId.get(item.id);
  if (exact && areKnowledgeGraphItemsSimilar(item, exact, "auxiliary")) {
    return exact;
  }

  const expectedSource = item.source_task_id ?? taskId;
  return (
    candidates.find(
      (candidate) =>
        candidate.id !== item.id &&
        candidate.source_task_id === expectedSource &&
        areKnowledgeGraphItemsSimilar(item, candidate, "auxiliary"),
    ) ?? null
  );
}

/**
 * 统计辅助项是否已经进入最终图谱，兼容重复 ID 被重编号的情况。
 */
function countCommittedAuxiliaryItems(
  result: ExecutorAgentResult,
  graphIndexes: ReturnType<typeof createGraphIndexes>,
): number {
  let count = 0;
  for (const item of result.decisions) {
    if (
      findCommittedAuxiliaryItem(
        item,
        result.task_id,
        graphIndexes.decisions,
        graphIndexes.decisionById,
      )
    ) {
      count += 1;
    }
  }
  for (const item of result.risks) {
    if (
      findCommittedAuxiliaryItem(
        item,
        result.task_id,
        graphIndexes.risks,
        graphIndexes.riskById,
      )
    ) {
      count += 1;
    }
  }
  for (const item of result.open_questions) {
    if (
      findCommittedAuxiliaryItem(
        item,
        result.task_id,
        graphIndexes.openQuestions,
        graphIndexes.openQuestionById,
      )
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * 将校验结果收敛为可机读的提交状态。
 */
function getExecutorCommitStatus({
  result,
  committedItemCount,
  totalItemCount,
}: {
  result: ExecutorAgentResult;
  committedItemCount: number;
  totalItemCount: number;
}): ExecutorUpdateRecord["commit_status"] {
  if (!result.quality_result.passed || totalItemCount === 0) {
    return "not_attempted";
  }
  if (committedItemCount >= totalItemCount) return "committed";
  return committedItemCount > 0 ? "partial" : "not_committed";
}

/**
 * 生成稳定校验问题。
 */
function createReviewIssue({
  code,
  severity,
  taskId,
  message,
}: {
  code: string;
  severity: "error" | "warning";
  taskId?: string;
  message: string;
}): CritiqueValidationIssue {
  return {
    code,
    severity,
    ...(taskId ? { task_id: taskId } : {}),
    message,
  };
}

/**
 * 按 Executor Agent 聚合任务，供依赖归一化时寻找同领域前序任务。
 */
/**
 * 灏?fallback 鍜?review 鏂囨湰闄愬埗鍦ㄨ緝鐭暱搴﹀唴锛岄伩鍏嶅鏌?payload 鎴?fallback 杈撳嚭杩囬暱銆? */
function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}
/**
 * 将瘦身 Critique Agent 输出与运行时已有状态组合成完整工作流结果。
 */
export function composeProductWorkflowResult(
  input: CritiqueAgentInput,
  review: CritiqueAgentOutput,
): ProductWorkflowResult {
  const validationReport = createCritiqueValidationReport(input);
  const proposalQuestions = reconcileProposalQuestions(
    review.proposal_questions,
    input.executorResults,
  );
  const plannedTaskIds = new Set(input.plan.tasks.map((task) => task.task_id));
  const retryTaskIds = mergeTextList([
    ...validationReport.retry_task_ids,
    ...review.review.retry_task_ids.filter((taskId) => plannedTaskIds.has(taskId)),
  ]);
  const rejectedTaskIds = mergeTextList([
    ...validationReport.rejected_task_ids,
    ...review.review.rejected_task_ids.filter((taskId) =>
      plannedTaskIds.has(taskId),
    ),
    ...retryTaskIds,
  ]);
  const rejectedTaskIdSet = new Set(rejectedTaskIds);
  const acceptedTaskIds = input.plan.tasks
    .map((task) => task.task_id)
    .filter((taskId) => !rejectedTaskIdSet.has(taskId));
  const reviewIssues = mergeReviewIssues([
    ...validationReport.issues,
    ...review.review.issues,
  ]);
  const graphIssues = mergeReviewIssues([
    ...validationReport.issues,
    ...review.knowledge_graph_review.issues,
  ]);
  const hasError = [...reviewIssues, ...graphIssues].some(
    (issue) => issue.severity === "error",
  );
  const needsConfirmation =
    proposalQuestions.length > 0 ||
    rejectedTaskIds.length > 0 ||
    retryTaskIds.length > 0 ||
    hasError;

  return {
    status: needsConfirmation ? "pending_user_confirmation" : "completed",
    confirmation_id: review.confirmation_id,
    request_summary: review.request_summary,
    planner: input.plan,
    executor_results: input.executorResults,
    review: {
      accepted_task_ids: acceptedTaskIds,
      rejected_task_ids: rejectedTaskIds,
      retry_task_ids: retryTaskIds,
      issues: reviewIssues,
      notes: review.review.notes,
    },
    product_context_update: review.product_context_update,
    knowledge_graph_update: {
      ...input.knowledgeGraph,
      notes: mergeTextList([
        ...input.knowledgeGraph.notes,
        ...review.knowledge_graph_review.notes.map(
          (note) => `Critique Agent：${note}`,
        ),
      ]),
    },
    knowledge_graph_review: {
      ...review.knowledge_graph_review,
      graph_ref: createKnowledgeGraphReviewRef(input.knowledgeGraph),
      accepted_task_ids: acceptedTaskIds,
      rejected_task_ids: rejectedTaskIds,
      retry_task_ids: retryTaskIds,
      issues: graphIssues,
    },
    proposal_questions: proposalQuestions,
    confirmation_message: needsConfirmation
      ? review.confirmation_message
      : "本轮任务已完成，所有可追溯的阻塞问题均已处理。",
  };
}

/**
 * 合并确定性与语义审查问题，避免同一问题重复展示。
 */
function mergeReviewIssues(
  issues: CritiqueValidationIssue[],
): CritiqueValidationIssue[] {
  const merged = new Map<string, CritiqueValidationIssue>();
  for (const issue of issues) {
    merged.set(
      [issue.code, issue.severity, issue.task_id ?? "", issue.message].join("|"),
      issue,
    );
  }
  return [...merged.values()];
}

/**
 * 只接受能追溯到真实 blocking OpenQuestion 的模型问题，并补齐模型遗漏的问题。
 */
export function reconcileProposalQuestions(
  reviewQuestions: CritiqueAgentOutput["proposal_questions"],
  executorResults: ExecutorAgentResult[],
): CritiqueAgentOutput["proposal_questions"] {
  const actualSources = new Map<
    string,
    { required: boolean; priority: number }
  >();
  for (const result of executorResults) {
    result.open_questions.forEach((question, index) => {
      actualSources.set(
        formatQuestionSourceKey({
          source_agent: result.agent_type,
          source_task_id: result.task_id,
          open_question_id: question.id,
        }),
        {
          required: question.blocking,
          priority: question.blocking ? 100 - index : 50 - index,
        },
      );
    });
  }

  const coveredSourceKeys = new Set<string>();
  const verified = reviewQuestions.flatMap((question) => {
    const sources = question.sources.filter((source) => {
      if (!source.open_question_id) return false;
      const key = formatQuestionSourceKey(source);
      if (!actualSources.has(key)) return false;
      coveredSourceKeys.add(key);
      return true;
    });
    const firstSource = sources[0];
    return firstSource
      ? [
          {
            ...question,
            required: sources.some((source) =>
              actualSources.get(formatQuestionSourceKey(source))?.required,
            ),
            priority: Math.max(
              ...sources.map(
                (source) =>
                  actualSources.get(formatQuestionSourceKey(source))
                    ?.priority ?? 0,
              ),
            ),
            source_task_id: firstSource.source_task_id,
            source_agent: firstSource.source_agent,
            sources,
          },
        ]
      : [];
  });

  const missing = createFallbackProposalQuestions(executorResults).flatMap(
    (question) => {
      const sources = question.sources.filter(
        (source) => !coveredSourceKeys.has(formatQuestionSourceKey(source)),
      );
      const firstSource = sources[0];
      return firstSource
        ? [
            {
              ...question,
              source_task_id: firstSource.source_task_id,
              source_agent: firstSource.source_agent,
              sources,
            },
          ]
        : [];
    },
  );

  return [...verified, ...missing].sort(
    (left, right) => right.priority - left.priority,
  );
}

/**
 * 生成稳定问题来源 key，防止模型伪造 missing-* ID 或错误任务归属。
 */
function formatQuestionSourceKey(
  source: ProductWorkflowProposalQuestion["sources"][number],
): string {
  return `${source.source_agent}:${source.source_task_id}:${source.open_question_id ?? ""}`;
}

/**
 * Critique Agent 不可用时生成瘦身回退审查结果，不再复制 Planner DAG、Executor 结果或完整图谱。
 */
function createFallbackCritiqueAgentOutput(
  input: CritiqueAgentInput,
  reason: string,
): CritiqueAgentOutput {
  const validationReport = createCritiqueValidationReport(input);
  const retryQuestion = createFallbackRetryQuestion(
    input.plan,
    validationReport,
  );
  const proposalQuestions = [
    ...(retryQuestion ? [retryQuestion] : []),
    ...createFallbackProposalQuestions(input.executorResults),
  ];
  const hasRetry = validationReport.retry_task_ids.length > 0;
  const status = hasRetry
    ? "requires_executor_retry"
    : proposalQuestions.length > 0
      ? "pending_user_confirmation"
      : "completed";
  const notes = createFallbackReviewNotes(validationReport, reason);
  const acceptedTaskIds = [...validationReport.accepted_task_ids];
  const rejectedTaskIds = [...validationReport.rejected_task_ids];
  const retryTaskIds = [...validationReport.retry_task_ids];
  const reviewIssues = cloneReviewIssues(validationReport.issues);
  const graphReviewIssues = cloneReviewIssues(validationReport.issues);

  return {
    status,
    confirmation_id: "product-workflow-confirmation",
    request_summary: truncateText(input.plan.request_summary, 500),
    review: {
      accepted_task_ids: acceptedTaskIds,
      rejected_task_ids: rejectedTaskIds,
      retry_task_ids: retryTaskIds,
      issues: reviewIssues,
      notes: truncateText(notes.join("；"), 1200),
    },
    product_context_update: createFallbackProductContextUpdate(
      input.plan,
      validationReport,
    ),
    knowledge_graph_review: {
      graph_ref: createKnowledgeGraphReviewRef(input.knowledgeGraph),
      accepted_task_ids: [...acceptedTaskIds],
      rejected_task_ids: [...rejectedTaskIds],
      retry_task_ids: [...retryTaskIds],
      issues: graphReviewIssues,
      notes: [...notes],
    },
    proposal_questions: proposalQuestions,
    confirmation_message: createFallbackConfirmationMessage({
      hasRetry,
      proposalQuestionCount: proposalQuestions.length,
    }),
  };
}

/**
 * 复制 Review 问题对象，避免本地诊断序列化器把跨字段复用引用误判为循环引用。
 */
function cloneReviewIssues(
  issues: CritiqueValidationIssue[],
): CritiqueValidationIssue[] {
  return issues.map((issue) => ({ ...issue }));
}

/**
 * 生成 fallback 审查说明，帮助恢复流程理解需要修正的任务范围。
 */
function createFallbackReviewNotes(
  validationReport: CritiqueValidationReport,
  reason: string,
): string[] {
  return [
    `Fallback reason: ${truncateText(reason, 160)}.`,
    `Accepted tasks: ${validationReport.accepted_task_ids.join(", ") || "none"}.`,
    `Tasks needing correction: ${validationReport.retry_task_ids.join(", ") || "none"}.`,
  ].slice(0, 8);
}

/**
 * 生成短产品上下文更新，避免 fallback 汇总重复所有 Executor 摘要。
 */
function createFallbackProductContextUpdate(
  plan: TaskExecutionPlan,
  validationReport: CritiqueValidationReport,
): string {
  return [
    `请求摘要：${truncateText(plan.request_summary, 180)}`,
    `已接受任务：${validationReport.accepted_task_ids.join(", ") || "无"}`,
    `待修正任务：${validationReport.retry_task_ids.join(", ") || "无"}`,
  ].join("\n");
}

/**
 * 基于确定性校验结果生成回退确认文案。
 */
function createFallbackConfirmationMessage({
  hasRetry,
  proposalQuestionCount,
}: {
  hasRetry: boolean;
  proposalQuestionCount: number;
}): string {
  if (hasRetry) {
    return "Critique Agent 发现部分任务的图谱提交需要修正，请先确认重试或补充方向。";
  }
  if (proposalQuestionCount > 0) {
    return "Critique Agent 已完成轻量汇总，请先补充最高优先级问题。";
  }
  return "Critique Agent 已完成轻量汇总，当前结果默认确认并结束本轮流程。";
}

/**
 * 确定性校验发现提交失败时，生成一个高优先级确认问题，避免流程静默完成。
 */
function createFallbackRetryQuestion(
  plan: TaskExecutionPlan,
  validationReport: CritiqueValidationReport,
): ProductWorkflowProposalQuestion | null {
  if (validationReport.retry_task_ids.length === 0) return null;

  const retryTasks = plan.tasks.filter((task) =>
    validationReport.retry_task_ids.includes(task.task_id),
  );
  const sources = retryTasks.map((task) => ({
    source_task_id: task.task_id,
    source_agent: task.assigned_agent,
  }));
  const firstSource = sources[0];

  return {
    id: "planner-review-retry",
    label: `审查发现 ${validationReport.retry_task_ids.join("、")} 的图谱写入存在问题，是否基于当前审查结论生成补充修正任务？`,
    type: "radio",
    required: true,
    options: ["生成补充修正任务", "先接受当前结果", "我补充修正要求"],
    source_task_id: firstSource?.source_task_id,
    source_agent: firstSource?.source_agent,
    sources,
    priority: 100,
  };
}

/**
 * Critique Agent 不可用时，把 Executor open question 降级为 textarea 问题，不做控件类型猜测。
 */
function createFallbackProposalQuestions(
  executorResults: ExecutorAgentResult[],
): CritiqueAgentOutput["proposal_questions"] {
  const questions = new Map<string, ProductWorkflowProposalQuestion>();

  for (const result of executorResults) {
    result.open_questions.forEach((question, index) => {
      const label = formatFallbackOpenQuestionLabel(
        question.text,
        result.task_id,
      );
      const key = normalizeFallbackQuestionText(label);
      if (!key) return;

      const source = {
        source_task_id: result.task_id,
        source_agent: result.agent_type,
        open_question_id: question.id,
      };
      const priority = question.blocking
        ? 100 - index
        : 50 - index;
      const existing = questions.get(key);
      if (existing) {
        existing.sources = mergeFallbackQuestionSources([
          ...existing.sources,
          source,
        ]);
        existing.priority = Math.max(existing.priority, priority);
        existing.required = existing.required || question.blocking;
        return;
      }

      questions.set(key, {
        id: `${result.task_id}-${question.id || `slot-${index + 1}`}`,
        label,
        type: "textarea",
        required: question.blocking,
        placeholder: "请补充这个问题所需的事实、约束或偏好。",
        source_task_id: result.task_id,
        source_agent: result.agent_type,
        sources: [source],
        priority,
      });
    });
  }

  return [...questions.values()].sort(
    (left, right) => right.priority - left.priority,
  );
}

/**
 * 合并文本列表，保持原始顺序并去掉空值。
 */
function mergeTextList(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

/**
 * fallback 阶段优先展示 Executor 写入的真实问题文本，只有异常空值才使用兜底文案。
 */
function formatFallbackOpenQuestionLabel(text: string, taskId: string): string {
  const trimmed = text.trim();
  if (trimmed) return trimmed;

  return `请补充 ${taskId} 需要确认的关键信息`;
}

/**
 * 归一化 fallback 问题文本，用于合并不同 Executor 提出的同一用户决策。
 */
function normalizeFallbackQuestionText(text: string): string {
  return text
    .trim()
    .replace(/[?？。.!！]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * 对 fallback 问题来源按 agent/task 去重。
 */
function mergeFallbackQuestionSources<
  T extends ProductWorkflowProposalQuestion["sources"][number],
>(sources: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const source of sources) {
    byKey.set(
      `${source.source_agent}:${source.source_task_id}:${source.open_question_id ?? ""}`,
      source,
    );
  }
  return [...byKey.values()];
}
