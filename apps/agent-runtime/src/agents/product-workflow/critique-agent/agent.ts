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
  ProductWorkflowKnowledgeGraphReviewSchema,
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
  resolveJsonOutput,
  runAgent,
} from "../../common/run-agent";
import { canExecutorUseWebSearch } from "../../common/tool-access";
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
 * 模型只负责审查结论；图谱引用由运行时从最终快照注入。
 */
export const CritiqueAgentModelOutputSchema = CritiqueAgentOutputSchema.extend({
  knowledge_graph_review: ProductWorkflowKnowledgeGraphReviewSchema.omit({
    graph_ref: true,
  }),
});

/**
 * Critique Agent：在 Executor 全部完成后审查工作流结果并生成用户确认数据。
 */
export async function* streamCritiqueAgent(
  input: CritiqueAgentInput,
): AsyncGenerator<ProductWorkflowStreamEvent, ProductWorkflowResult, void> {
  const maxAttempts = input.documentEvidenceResolution ? 2 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let fallbackReason: string | null = null;
    const review = yield* runAgent({
      agentType: "critique",
      agentLabel: "Critique Agent",
      name: `critique-agent${attempt > 1 ? "-structured-retry" : ""}`,
      modelOptions: {
        ...JSON_AGENT_MODEL_OPTIONS,
        maxTokens: 16384,
      },
      modelProfile: input.modelProfile,
      modelGroup: "critique",
      systemPrompt: CRITIQUE_AGENT_PROMPT,
      payload: {
        ...createCritiqueAgentPayload(input),
        ...(attempt > 1
          ? {
              structured_output_retry:
                "The previous response failed final JSON validation. Put the complete JSON object in final answer content, not only in reasoning.",
            }
          : {}),
      },
      resolveOutput: (context) =>
        resolveJsonOutput(context, CritiqueAgentModelOutputSchema),
      fallback: (reason) => {
        fallbackReason = reason;
        return createFallbackCritiqueAgentOutput(input, reason);
      },
      suppressFallbackReasoning: input.documentEvidenceResolution,
      signal: input.signal,
    });

    if (!fallbackReason) return composeProductWorkflowResult(input, review);
    if (!input.documentEvidenceResolution) {
      return composeProductWorkflowResult(input, review);
    }
    if (attempt < maxAttempts) {
      yield {
        type: "reasoning",
        agentType: "critique",
        content:
          "Critique Agent 未生成可验收的结构化结果，正在原地重试一次。\n",
      };
    }
  }

  throw new Error(
    "Critique Agent 连续两次未生成有效结构化结果，证据解决流程尚未完成，请重试当前会话。",
  );
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
  semantic_integrity: {
    active_semantic_conflict_node_ids: string[];
    stale_deprecated_downstream_node_ids: string[];
    uncovered_user_input_indexes: number[];
    untraceable_node_ids: string[];
    unverified_evidence_ids: string[];
    broken_delivery_chain_requirement_ids: string[];
    missing_supplement_metric_requirement_ids: string[];
    unresolved_blocking_question_ids: string[];
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
    task_semantic_updates: compactTaskSemanticUpdates(
      input.executorResults,
      input.knowledgeGraph,
    ),
    validation_report: validationReport,
    prior_unresolved_issues: (input.priorIssues ?? []).map((issue) => ({
      issue_key: createReviewIssueKey(issue),
      ...issue,
    })),
    non_blocking_risk_candidates: input.knowledgeGraph.risks.map((risk) => ({
      ...risk,
      text: truncateText(risk.text, 240),
    })),
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
  knowledgeGraph?: ProductKnowledgeGraph,
) {
  const entityById = new Map(
    (knowledgeGraph?.entities ?? []).map((entity) => [entity.id, entity]),
  );
  const compactEntity = (entity: KnowledgeGraphEntity | undefined) =>
    entity
      ? {
          id: entity.id,
          type: entity.type,
          name: truncateText(entity.name, 120),
          description: entity.description
            ? truncateText(entity.description, 280)
            : undefined,
          status: entity.status,
          provenance: entity.provenance,
          source_task_id: entity.source_task_id,
        }
      : undefined;

  return executorResults.map((result) => ({
    task_id: result.task_id,
    agent_type: result.agent_type,
    web_search_enabled: canExecutorUseWebSearch(result.agent_type),
    summary: truncateText(result.summary, 240),
    entities: result.entities.map((entity) => ({
      ...compactEntity(entity)!,
      deprecated_by_task_id: entity.deprecated_by_task_id,
      deprecation_reason: entity.deprecation_reason
        ? truncateText(entity.deprecation_reason, 220)
        : undefined,
      replacement_node_id: entity.replacement_node_id,
    })),
    relations: result.relations.map((relation) => ({
      id: relation.id,
      type: relation.type,
      source: relation.source,
      target: relation.target,
      description: relation.description
        ? truncateText(relation.description, 180)
        : undefined,
      source_context: compactEntity(entityById.get(relation.source)),
      target_context: compactEntity(entityById.get(relation.target)),
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
  const activeEntities = knowledgeGraph.entities.filter(
    (item) => item.status !== "deprecated",
  );
  const activeEntityIds = new Set(activeEntities.map((item) => item.id));
  const activeRelations = knowledgeGraph.relations.filter(
    (item) =>
      activeEntityIds.has(item.source) && activeEntityIds.has(item.target),
  );
  return {
    graph_ref: createKnowledgeGraphReviewRef(knowledgeGraph),
    total_entity_count: knowledgeGraph.entities.length,
    active_entity_count: activeEntities.length,
    entity_counts: countBy(activeEntities.map((item) => item.type)),
    deprecated_entity_count:
      knowledgeGraph.entities.length - activeEntities.length,
    total_relation_count: knowledgeGraph.relations.length,
    active_relation_count: activeRelations.length,
    inactive_relation_count:
      knowledgeGraph.relations.length - activeRelations.length,
    relation_counts: countBy(activeRelations.map((item) => item.type)),
    decision_count: knowledgeGraph.decisions.length,
    risk_count: knowledgeGraph.risks.length,
    open_question_count: knowledgeGraph.open_questions.length,
    blocking_open_question_count: knowledgeGraph.open_questions.filter(
      (item) => item.blocking,
    ).length,
    entity_ids_by_task: groupIdsBySourceTask(activeEntities),
    deprecated_entity_ids_by_task: groupIdsBySourceTask(
      knowledgeGraph.entities.filter(
        (entity) => entity.status === "deprecated",
      ),
    ),
    relation_ids_by_task: groupIdsBySourceTask(activeRelations),
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
  const semanticIntegrity = inspectSemanticIntegrity(input);
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
        ...validateExecutorBoundaries(
          result,
          task.assigned_agent,
          input.documentEvidenceResolution === true,
        ),
      );
    }
    taskIssues.push(
      ...validateExpectedOutputContract(task, result, input.knowledgeGraph),
    );

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
  const semanticIntegrityIssues = createSemanticIntegrityIssues(
    input,
    semanticIntegrity,
  );
  for (const issue of semanticIntegrityIssues) {
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
    semantic_integrity: semanticIntegrity,
  };
}

/**
 * 检查活跃图谱的来源、用户输入覆盖和端到端交付链。
 */
function inspectSemanticIntegrity(
  input: CritiqueAgentInput,
): CritiqueValidationReport["semantic_integrity"] {
  const currentTaskIds = new Set(input.plan.tasks.map((task) => task.task_id));
  const activeEntities = input.knowledgeGraph.entities.filter(
    (entity) => entity.status !== "deprecated",
  );
  const activeEntityById = new Map(
    activeEntities.map((entity) => [entity.id, entity]),
  );
  const activeRelations = input.knowledgeGraph.relations.filter(
    (relation) =>
      activeEntityById.has(relation.source) &&
      activeEntityById.has(relation.target),
  );
  const currentEntities = input.executorResults.flatMap((result) =>
    result.entities.filter(
      (entity) =>
        currentTaskIds.has(entity.source_task_id ?? result.task_id) ||
        entity.deprecated_by_task_id === result.task_id,
    ),
  );
  const untraceableNodeIds = currentEntities
    .filter(
      (entity) =>
        entity.status !== "deprecated" &&
        (!entity.provenance || entity.provenance.length === 0),
    )
    .map((entity) => entity.id);
  const unverifiedEvidenceIds = currentEntities
    .filter(
      (entity) =>
        entity.status !== "deprecated" &&
        entity.type === "Evidence" &&
        !entity.provenance?.some(
          (source) =>
            source.kind === "user_input" || source.kind === "web_search",
        ),
    )
    .map((entity) => entity.id);
  const uncoveredUserInputIndexes = findUncoveredUserInputIndexes(
    input,
    activeEntities,
  );
  const deliveryRequirements = selectDeliveryChainRequirements(
    input,
    activeEntities,
  );
  const brokenDeliveryChainRequirementIds = deliveryRequirements
    .filter(
      (requirement) =>
        !hasRequirementDeliveryChain(
          requirement.id,
          activeEntityById,
          activeRelations,
        ),
    )
    .map((requirement) => requirement.id);
  const activeMetricsExist = activeEntities.some(
    (entity) => entity.type === "Metric",
  );
  const missingSupplementMetricRequirementIds =
    input.plan.status === "supplement" && activeMetricsExist
      ? deliveryRequirements
          .filter(
            (requirement) =>
              !hasRequirementMetricCoverage(
                requirement.id,
                activeEntityById,
                activeRelations,
              ),
          )
          .map((requirement) => requirement.id)
      : [];

  return {
    active_semantic_conflict_node_ids: findActiveScopeConflictNodeIds(
      input.userInput ?? [],
      activeEntities,
    ),
    stale_deprecated_downstream_node_ids: findStaleDeprecatedDownstreamNodeIds(
      input.knowledgeGraph.entities,
      input.knowledgeGraph.relations,
    ),
    uncovered_user_input_indexes: uncoveredUserInputIndexes,
    untraceable_node_ids: [...new Set(untraceableNodeIds)],
    unverified_evidence_ids: [...new Set(unverifiedEvidenceIds)],
    broken_delivery_chain_requirement_ids: [
      ...new Set(brokenDeliveryChainRequirementIds),
    ],
    missing_supplement_metric_requirement_ids: [
      ...new Set(missingSupplementMetricRequirementIds),
    ],
    unresolved_blocking_question_ids: input.knowledgeGraph.open_questions
      .filter((question) => question.blocking)
      .map((question) => question.id),
  };
}

/**
 * 将确定性语义缺口提升为工作流终止门禁。
 */
function createSemanticIntegrityIssues(
  input: CritiqueAgentInput,
  integrity: CritiqueValidationReport["semantic_integrity"],
): CritiqueValidationIssue[] {
  const entityById = new Map(
    input.knowledgeGraph.entities.map((entity) => [entity.id, entity]),
  );
  const issues: CritiqueValidationIssue[] = [];

  for (const nodeId of integrity.untraceable_node_ids) {
    const entity = entityById.get(nodeId);
    issues.push(
      createReviewIssue({
        code: "UNTRACEABLE_NODE_PROVENANCE",
        severity: "error",
        taskId: findCurrentOwnerTaskId(input, entity),
        message: `New active node ${nodeId} has no auditable user-input, web-search, or existing-graph provenance.`,
      }),
    );
  }
  for (const evidenceId of integrity.unverified_evidence_ids) {
    const entity = entityById.get(evidenceId);
    issues.push(
      createReviewIssue({
        code: "UNVERIFIED_EVIDENCE_SOURCE",
        severity: "error",
        taskId: findCurrentOwnerTaskId(input, entity),
        message: `Evidence ${evidenceId} is not backed by explicit user input or a verified web-search source.`,
      }),
    );
  }
  for (const inputIndex of integrity.uncovered_user_input_indexes) {
    issues.push(
      createReviewIssue({
        code: "UNCOVERED_USER_INPUT",
        severity: "error",
        taskId: findUserInputOwnerTaskId(input, inputIndex),
        message: `Explicit user input ${inputIndex} is not represented by an active Requirement, Decision, Risk, or OpenQuestion.`,
      }),
    );
  }
  for (const nodeId of integrity.active_semantic_conflict_node_ids) {
    const entity = entityById.get(nodeId);
    issues.push(
      createReviewIssue({
        code: "ACTIVE_SCOPE_CONFLICT",
        severity: "error",
        taskId: findCurrentOwnerTaskId(input, entity),
        message: `Active node ${nodeId} conflicts with an explicit exclusion in the current user input and must be deprecated or corrected.`,
      }),
    );
  }
  for (const nodeId of integrity.stale_deprecated_downstream_node_ids) {
    const entity = entityById.get(nodeId);
    issues.push(
      createReviewIssue({
        code: "STALE_DEPRECATED_DOWNSTREAM",
        severity: "error",
        taskId: findCurrentOwnerTaskId(input, entity),
        message: `Active downstream node ${nodeId} depends only on a deprecated Requirement or Feature branch and must be replaced, reconnected, or deprecated.`,
      }),
    );
  }
  for (const requirementId of integrity.broken_delivery_chain_requirement_ids) {
    const entity = entityById.get(requirementId);
    issues.push(
      createReviewIssue({
        code: "BROKEN_REQUIREMENT_DELIVERY_CHAIN",
        severity: "error",
        taskId: findCurrentOwnerTaskId(input, entity),
        message: `Requirement ${requirementId} must reuse and reconnect a compatible active Feature/Component delivery chain, or create only the missing nodes.`,
      }),
    );
  }
  for (const requirementId of integrity.missing_supplement_metric_requirement_ids) {
    const entity = entityById.get(requirementId);
    issues.push(
      createReviewIssue({
        code: "MISSING_SUPPLEMENT_METRIC_PROPAGATION",
        severity: "error",
        taskId: findCurrentOwnerTaskId(input, entity),
        message: `Supplement Requirement ${requirementId} must reuse and reconnect a compatible active Metric, or create one only when no compatible Metric exists.`,
      }),
    );
  }

  return issues;
}

/**
 * 只选择需要完整交付链的本轮 Requirement，避免把概念基础图误判为完整设计。
 */
function selectDeliveryChainRequirements(
  input: CritiqueAgentInput,
  activeEntities: KnowledgeGraphEntity[],
): KnowledgeGraphEntity[] {
  const currentTaskIds = new Set(input.plan.tasks.map((task) => task.task_id));
  const isCompleteInitialDesign =
    input.plan.status === "initial" &&
    input.plan.tasks.some(
      (task) => task.assigned_agent === "executor-product-execution",
    ) &&
    !/概念基础(?:图)?|concept foundation/i.test(
      `${input.plan.request_summary} ${input.plan.assumptions.join(" ")}`,
    );
  if (!isCompleteInitialDesign && input.plan.status !== "supplement") return [];
  if (
    input.plan.status === "supplement" &&
    !activeEntities.some(
      (entity) => entity.type === "Feature" || entity.type === "Component",
    )
  ) {
    return [];
  }

  return activeEntities.filter(
    (entity) =>
      entity.type === "Requirement" &&
      currentTaskIds.has(entity.source_task_id ?? ""),
  );
}

/**
 * 校验 Requirement 是否能沿固定方向落到 Feature 和 Component。
 */
function hasRequirementDeliveryChain(
  requirementId: string,
  entityById: Map<string, KnowledgeGraphEntity>,
  relations: KnowledgeGraphRelation[],
): boolean {
  const featureIds = relations
    .filter(
      (relation) =>
        relation.type === "Satisfies" && relation.target === requirementId,
    )
    .map((relation) => relation.source)
    .filter((id) => entityById.get(id)?.type === "Feature");
  if (featureIds.length === 0) return false;

  const featureIdSet = new Set(featureIds);
  return relations.some(
    (relation) =>
      relation.type === "Implements" &&
      featureIdSet.has(relation.target) &&
      entityById.get(relation.source)?.type === "Component",
  );
}

/**
 * 补充需求在已有指标层存在时必须同步到 Requirement 或其 Feature。
 */
function hasRequirementMetricCoverage(
  requirementId: string,
  entityById: Map<string, KnowledgeGraphEntity>,
  relations: KnowledgeGraphRelation[],
): boolean {
  const featureIds = new Set(
    relations
      .filter(
        (relation) =>
          relation.type === "Satisfies" && relation.target === requirementId,
      )
      .map((relation) => relation.source),
  );

  return relations.some(
    (relation) =>
      relation.type === "Measures" &&
      entityById.get(relation.source)?.type === "Metric" &&
      (relation.target === requirementId || featureIds.has(relation.target)),
  );
}

/**
 * 找出尚未进入业务图谱或风险/问题记录的明确用户输入。
 */
function findUncoveredUserInputIndexes(
  input: CritiqueAgentInput,
  activeEntities: KnowledgeGraphEntity[],
): number[] {
  const userInput = input.userInput ?? [];
  if (userInput.length === 0) return [];
  const directlyCovered = new Set(
    activeEntities.flatMap((entity) =>
      ["Requirement", "Decision", "Risk", "OpenQuestion"].includes(entity.type)
        ? (entity.provenance ?? []).flatMap((source) =>
            source.kind === "user_input" ? [source.user_input_index] : [],
          )
        : [],
    ),
  );
  const artifactTexts = [
    ...activeEntities
      .filter(
        (entity) =>
          entity.type === "Requirement" || entity.type === "Decision",
      )
      .map((entity) => `${entity.name} ${entity.description ?? ""}`),
    ...input.knowledgeGraph.risks.map((risk) => risk.text),
    ...input.knowledgeGraph.open_questions.map((question) => question.text),
  ];

  return userInput
    .filter(
      (item) =>
        !directlyCovered.has(item.index) &&
        !artifactTexts.some((text) =>
          hasMeaningfulTextOverlap(item.content, text),
        ),
    )
    .map((item) => item.index);
}

/**
 * 从用户否定或排除语句中找出仍被活跃节点肯定表达的范围。
 */
function findActiveScopeConflictNodeIds(
  userInput: Array<{ content: string }>,
  activeEntities: KnowledgeGraphEntity[],
): string[] {
  const deniedPhrases = userInput.flatMap((item) =>
    extractDeniedPhrases(item.content),
  );
  if (deniedPhrases.length === 0) return [];

  return activeEntities
    .filter((entity) => {
      const text = `${entity.name} ${entity.description ?? ""}`;
      const normalized = normalizeSemanticText(text);
      return deniedPhrases.some(
        (phrase) =>
          normalized.includes(phrase) &&
          !isPhraseExplicitlyNegated(text, phrase),
      );
    })
    .map((entity) => entity.id);
}

/**
 * 找出只依赖已废弃 Requirement/Feature 分支的活跃 Feature、Component 与 Metric。
 */
function findStaleDeprecatedDownstreamNodeIds(
  entities: KnowledgeGraphEntity[],
  relations: KnowledgeGraphRelation[],
): string[] {
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const activeIds = new Set(
    entities
      .filter((entity) => entity.status !== "deprecated")
      .map((entity) => entity.id),
  );
  const deprecatedIds = new Set(
    entities
      .filter((entity) => entity.status === "deprecated")
      .map((entity) => entity.id),
  );
  const staleIds = new Set<string>();

  for (const feature of entities.filter(
    (entity) => entity.type === "Feature" && activeIds.has(entity.id),
  )) {
    const satisfies = relations.filter(
      (relation) =>
        relation.type === "Satisfies" && relation.source === feature.id,
    );
    const dependsOnDeprecated = satisfies.some((relation) =>
      deprecatedIds.has(relation.target),
    );
    const hasActiveRequirement = satisfies.some(
      (relation) =>
        activeIds.has(relation.target) &&
        entityById.get(relation.target)?.type === "Requirement",
    );
    if (dependsOnDeprecated && !hasActiveRequirement) staleIds.add(feature.id);
  }

  for (const component of entities.filter(
    (entity) => entity.type === "Component" && activeIds.has(entity.id),
  )) {
    const implementsRelations = relations.filter(
      (relation) =>
        relation.type === "Implements" && relation.source === component.id,
    );
    const dependsOnRetiredFeature = implementsRelations.some(
      (relation) =>
        deprecatedIds.has(relation.target) || staleIds.has(relation.target),
    );
    const hasActiveFeature = implementsRelations.some(
      (relation) =>
        activeIds.has(relation.target) &&
        !staleIds.has(relation.target) &&
        entityById.get(relation.target)?.type === "Feature",
    );
    if (dependsOnRetiredFeature && !hasActiveFeature) {
      staleIds.add(component.id);
    }
  }

  for (const metric of entities.filter(
    (entity) => entity.type === "Metric" && activeIds.has(entity.id),
  )) {
    const measuresRelations = relations.filter(
      (relation) =>
        relation.type === "Measures" && relation.source === metric.id,
    );
    const dependsOnRetiredScope = measuresRelations.some(
      (relation) =>
        deprecatedIds.has(relation.target) || staleIds.has(relation.target),
    );
    const hasActiveMeasuredScope = measuresRelations.some((relation) => {
      const target = entityById.get(relation.target);
      return (
        activeIds.has(relation.target) &&
        !staleIds.has(relation.target) &&
        (target?.type === "Requirement" || target?.type === "Feature")
      );
    });
    if (dependsOnRetiredScope && !hasActiveMeasuredScope) {
      staleIds.add(metric.id);
    }
  }

  return [...staleIds];
}

/**
 * 提取中英文否定短语，面向“无全文搜索”“不包含 WYSIWYG”等明确范围回答。
 */
function extractDeniedPhrases(value: string): string[] {
  const phrases: string[] = [];
  for (const clause of value.split(/[，。；;\n]/)) {
    const chinese =
      /(?:不包含|不支持|不需要|不考虑|禁止|排除|无)([^，。；;]{2,40})/i.exec(
        clause,
      )?.[1];
    const english =
      /(?:does\s+not\s+include|do\s+not\s+support|without|exclude|no)\s+([^,.;]{2,40})/i.exec(
        clause,
      )?.[1];
    for (const phrase of [chinese, english]) {
      if (!phrase) continue;
      const normalized = normalizeSemanticText(
        phrase.replace(/^(?:任何|相关|the|any|a|an)\s+/i, ""),
      );
      if (normalized.length >= 2) phrases.push(normalized);
    }
  }
  return [...new Set(phrases)];
}

/**
 * 判断节点自身是否也在明确表达否定，避免把“禁用全文搜索”当成冲突节点。
 */
function isPhraseExplicitlyNegated(text: string, normalizedPhrase: string): boolean {
  const normalized = normalizeSemanticText(text);
  return [
    "不包含",
    "不支持",
    "不需要",
    "不考虑",
    "禁止",
    "排除",
    "无",
    "without",
    "exclude",
    "no",
  ].some((marker) =>
    normalized.includes(`${normalizeSemanticText(marker)}${normalizedPhrase}`),
  );
}

/**
 * 使用轻量关键词交集兼容中英文表述，不引入额外相似度依赖。
 */
function hasMeaningfulTextOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeSemanticText(left);
  const normalizedRight = normalizeSemanticText(right);
  if (
    normalizedLeft.length >= 4 &&
    normalizedRight.includes(normalizedLeft)
  ) {
    return true;
  }
  const leftTokens = extractSemanticTokens(left);
  const rightTokens = new Set(extractSemanticTokens(right));
  const overlap = leftTokens.filter((token) => rightTokens.has(token)).length;
  return overlap >= Math.min(2, Math.max(1, leftTokens.length));
}

/**
 * 提取英文关键词和中文双字片段。
 */
function extractSemanticTokens(value: string): string[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  const latin =
    normalized
      .match(/[a-z0-9][a-z0-9_-]{1,}/g)
      ?.filter(
        (token) =>
          !["the", "and", "for", "with", "user", "用户", "需要"].includes(
            token,
          ),
      ) ?? [];
  const han = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const hanPairs = han.flatMap((sequence) => {
    const pairs: string[] = [];
    for (let index = 0; index < sequence.length - 1; index += 1) {
      pairs.push(sequence.slice(index, index + 2));
    }
    return pairs;
  });
  return [...new Set([...latin, ...hanPairs])];
}

/**
 * 统一语义比较文本。
 */
function normalizeSemanticText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s"'`“”‘’()[\]{}<>《》【】:_-]+/g, "");
}

/**
 * 为语义问题找到本轮可执行的领域所有者。
 */
function findCurrentOwnerTaskId(
  input: CritiqueAgentInput,
  entity: KnowledgeGraphEntity | undefined,
): string | undefined {
  if (entity?.source_task_id) {
    const exact = input.plan.tasks.find(
      (task) => task.task_id === entity.source_task_id,
    );
    if (exact) return exact.task_id;
  }
  if (entity) {
    const domainOwner = input.plan.tasks.find(
      (task) =>
        isExecutorAgentType(task.assigned_agent) &&
        getExecutorDefinition(task.assigned_agent).allowedEntityTypes.includes(
          entity.type as never,
        ),
    );
    if (domainOwner) return domainOwner.task_id;
  }
  return input.plan.tasks[0]?.task_id;
}

/**
 * 根据 Request Agent 的业务覆盖映射找到遗漏输入的本轮任务。
 */
function findUserInputOwnerTaskId(
  input: CritiqueAgentInput,
  userInputIndex: number,
): string | undefined {
  const businessIndexes = input.requestAnalysis.business_model
    .filter((item) => item.covered_user_input_indexes.includes(userInputIndex))
    .map((item) => item.index);
  return (
    input.plan.tasks.find((task) =>
      task.covered_business_model_indexes.some((index) =>
        businessIndexes.includes(index),
      ),
    )?.task_id ?? input.plan.tasks[0]?.task_id
  );
}

/**
 * 对适合程序判断的语义质量问题增加门禁。
 */
function createSemanticQualityIssues(
  input: CritiqueAgentInput,
): CritiqueValidationIssue[] {
  const issues: CritiqueValidationIssue[] = [];
  const currentTaskIds = new Set(input.plan.tasks.map((task) => task.task_id));
  const metrics = input.knowledgeGraph.entities.filter(
    (entity) => entity.type === "Metric",
  );
  const measuredMetricIds = new Set(
    input.knowledgeGraph.relations
      .filter((relation) => relation.type === "Measures")
      .map((relation) => relation.source),
  );
  const duplicatePairs = new Set<string>();

  issues.push(...createSuccessTargetCoverageIssues(input));

  // 本轮创建的 Metric 必须落到业务目标、功能或需求上，否则指标任务尚未完成。
  for (const task of input.plan.tasks) {
    const unmeasuredMetricIds = metrics
      .filter(
        (metric) =>
          metric.source_task_id === task.task_id &&
          !measuredMetricIds.has(metric.id),
      )
      .map((metric) => metric.id);
    if (unmeasuredMetricIds.length === 0) continue;

    issues.push(
      createReviewIssue({
        code: "UNMEASURED_METRIC",
        severity: "error",
        taskId: task.task_id,
        message: `Metric nodes have no outgoing Measures relation: ${formatCompactIdList(unmeasuredMetricIds)}.`,
      }),
    );
  }

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
        severity: input.documentEvidenceResolution ? "error" : "warning",
        taskId: evidence.source_task_id!,
        message: `Evidence ${evidence.id} is not consumed by a Validates or References relation.`,
      }),
    );
  }

  return issues;
}

/**
 * 校验 Planner expected_output 中可确定判断的最小产物契约。
 *
 * 自由文本中的主观质量仍交给 Critique；这里只拦截明确要求的实体和关系完全缺失，
 * 避免“研究缺口”之类的替代产物被当成已完成 Evidence 任务。
 */
function validateExpectedOutputContract(
  task: TaskExecutionPlan["tasks"][number],
  result: ExecutorAgentResult,
  knowledgeGraph: ProductKnowledgeGraph,
): CritiqueValidationIssue[] {
  const expectation = task.expected_output.replace(
    /Allowed entities only:[^.]+\.?/gi,
    "",
  );
  const activeEntities = result.entities.filter(
    (entity) => entity.status !== "deprecated",
  );
  const activeEntityTypes = new Set(activeEntities.map((entity) => entity.type));
  const graphEntityById = new Map(
    knowledgeGraph.entities
      .filter((entity) => entity.status !== "deprecated")
      .map((entity) => [entity.id, entity]),
  );
  const issues: CritiqueValidationIssue[] = [];

  const requiredEntityTypes = [
    {
      type: "Evidence",
      required: /\b(?:source-verifiable|verified)\s+Evidence\b/i.test(
        expectation,
      ),
    },
    {
      type: "Component",
      required: /\b(?:minimum\s+MVP\s+)?Component breakdown\b/i.test(
        expectation,
      ),
    },
    {
      type: "Feature",
      required: /\bFeature (?:hypotheses|nodes?|set)\b/i.test(expectation),
    },
    {
      type: "Decision",
      required: /^\s*(?:Technology\s+)?Decision\b/i.test(expectation),
    },
  ] as const;

  for (const requirement of requiredEntityTypes) {
    if (
      requirement.required &&
      !activeEntityTypes.has(requirement.type)
    ) {
      issues.push(
        createReviewIssue({
          code: "EXPECTED_OUTPUT_ENTITY_MISSING",
          severity: "error",
          taskId: task.task_id,
          message: `Task expected_output requires ${requirement.type}, but the executor committed no active ${requirement.type} entity.`,
        }),
      );
    }
  }

  const requiresAcceptanceArtifact =
    /\bacceptance Requirements? or Metrics?\b/i.test(expectation);
  if (
    requiresAcceptanceArtifact &&
    !hasExpectedArtifactReference(
      result,
      graphEntityById,
      new Set(["Requirement", "Metric"]),
    )
  ) {
    issues.push(
      createReviewIssue({
        code: "EXPECTED_OUTPUT_ACCEPTANCE_ARTIFACT_MISSING",
        severity: "error",
        taskId: task.task_id,
        message:
          "Task expected_output requires a traceable acceptance Requirement or Metric, but neither was created or referenced.",
      }),
    );
  }

  if (
    /\btraceable relation updates?\b/i.test(expectation) &&
    activeEntities.length > 0 &&
    result.relations.length === 0
  ) {
    issues.push(
      createReviewIssue({
        code: "EXPECTED_OUTPUT_RELATION_MISSING",
        severity: "error",
        taskId: task.task_id,
        message:
          "Task expected_output requires traceable relation updates, but the executor committed no relation.",
      }),
    );
  }

  const evidenceIds = new Set(
    activeEntities
      .filter((entity) => entity.type === "Evidence")
      .map((entity) => entity.id),
  );
  if (
    evidenceIds.size > 0 &&
    /\bEvidence\b.*\blinked to\b.*\bRequirements?\b/i.test(expectation) &&
    !result.relations.some(
      (relation) =>
        evidenceIds.has(relation.source) &&
        ["Validates", "References"].includes(relation.type) &&
        ["Requirement", "Decision"].includes(
          graphEntityById.get(relation.target)?.type ?? "",
        ),
    )
  ) {
    issues.push(
      createReviewIssue({
        code: "EXPECTED_OUTPUT_EVIDENCE_LINK_MISSING",
        severity: "error",
        taskId: task.task_id,
        message:
          "Task expected_output requires Evidence linked to a Requirement or decision candidate, but no such relation was committed.",
      }),
    );
  }

  const componentIds = new Set(
    activeEntities
      .filter((entity) => entity.type === "Component")
      .map((entity) => entity.id),
  );
  if (
    componentIds.size > 0 &&
    /\bComponent breakdown linked to Features?\b/i.test(expectation) &&
    !result.relations.some(
      (relation) =>
        componentIds.has(relation.source) &&
        relation.type === "Implements" &&
        graphEntityById.get(relation.target)?.type === "Feature",
    )
  ) {
    issues.push(
      createReviewIssue({
        code: "EXPECTED_OUTPUT_COMPONENT_LINK_MISSING",
        severity: "error",
        taskId: task.task_id,
        message:
          "Task expected_output requires Components linked to Features, but no Component --Implements--> Feature relation was committed.",
      }),
    );
  }

  return issues;
}

/**
 * 判断任务是否创建或通过本轮关系引用了指定验收实体。
 */
function hasExpectedArtifactReference(
  result: ExecutorAgentResult,
  graphEntityById: Map<string, KnowledgeGraphEntity>,
  expectedTypes: Set<KnowledgeGraphEntity["type"]>,
): boolean {
  if (
    result.entities.some(
      (entity) =>
        entity.status !== "deprecated" && expectedTypes.has(entity.type),
    )
  ) {
    return true;
  }

  return result.relations.some((relation) =>
    [relation.source, relation.target].some((id) => {
      const entity = graphEntityById.get(id);
      return Boolean(entity && expectedTypes.has(entity.type));
    }),
  );
}

/**
 * 用户明确给出的量化成功标准必须进入 Requirement 或 Metric，不能在流程结束时丢失。
 */
function createSuccessTargetCoverageIssues(
  input: CritiqueAgentInput,
): CritiqueValidationIssue[] {
  const artifacts = input.knowledgeGraph.entities
    .filter((entity) => entity.type === "Requirement" || entity.type === "Metric")
    .map((entity) => normalizeMetricText(`${entity.name} ${entity.description ?? ""}`));
  const issues: CritiqueValidationIssue[] = [];

  for (const businessModel of input.requestAnalysis.business_model) {
    for (const constraint of businessModel.goal_constraints) {
      const normalizedConstraint = normalizeMetricText(constraint);
      if (!isExplicitSuccessTarget(normalizedConstraint)) continue;

      const targetValues = normalizedConstraint.match(/\d+(?:\.\d+)?%?/g) ?? [];
      const targetDimension = getSuccessTargetDimension(normalizedConstraint);
      if (
        targetValues.length === 0 ||
        targetValues.every((value) =>
          artifacts.some(
            (artifact) =>
              artifact.includes(value) &&
              (!targetDimension || artifact.includes(targetDimension)),
          ),
        )
      ) {
        continue;
      }

      const ownerTask = findSuccessTargetOwnerTask(input.plan, businessModel.index);
      issues.push(
        createReviewIssue({
          code: "MISSING_SUCCESS_TARGET_COVERAGE",
          severity: "error",
          taskId: ownerTask?.task_id,
          message: `Explicit success target is not represented by a Requirement or Metric: ${truncateText(constraint, 220)}`,
        }),
      );
    }
  }

  return issues;
}

/**
 * 优先让具备 Metric 写入权限的已规划任务补齐成功标准，否则回退到同业务项首个任务。
 */
function findSuccessTargetOwnerTask(
  plan: TaskExecutionPlan,
  businessModelIndex: number,
) {
  const candidates = plan.tasks.filter((task) =>
    task.covered_business_model_indexes.includes(businessModelIndex),
  );
  return (
    candidates.find(
      (task) =>
        isExecutorAgentType(task.assigned_agent) &&
        getExecutorDefinition(task.assigned_agent).allowedEntityTypes.some(
          (entityType) => entityType === "Metric",
        ),
    ) ?? candidates[0]
  );
}

/**
 * 只识别明确的成功/KPI语句，避免把“20-200人”等普通约束误判成指标。
 */
function isExplicitSuccessTarget(text: string): boolean {
  return /成功标准|成功指标|满意度|采用率|迁移率|留存率|转化率|活跃率|success\s*(?:metric|criterion|target)|satisfaction|adoption\s*rate|retention\s*rate|conversion\s*rate/i.test(
    text,
  );
}

/**
 * 提取常见成功指标维度，避免用无关指标中的相同数字误判为已覆盖。
 */
function getSuccessTargetDimension(text: string): string | null {
  if (/满意度|satisfaction/.test(text)) {
    return text.includes("满意度") ? "满意度" : "satisfaction";
  }
  if (/迁移率|迁移到|adoption/.test(text)) {
    return text.includes("迁移") ? "迁移" : "adoption";
  }
  if (/留存率|retention/.test(text)) {
    return text.includes("留存") ? "留存" : "retention";
  }
  if (/转化率|conversion/.test(text)) {
    return text.includes("转化") ? "转化" : "conversion";
  }
  if (/活跃率|active\s*rate/.test(text)) {
    return text.includes("活跃") ? "活跃" : "active";
  }
  return null;
}

/**
 * 统一全角字符、大小写和空白，使数值目标比较保持稳定。
 */
function normalizeMetricText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/**
 * 确定性校验 Executor 是否越过其实体和关系类型边界。
 */
function validateExecutorBoundaries(
  result: ExecutorAgentResult,
  assignedAgent: ExecutorAgentType,
  allowResolvedRisk: boolean,
): CritiqueValidationIssue[] {
  const definition = getExecutorDefinition(assignedAgent);
  const unauthorizedEntityTypes = [
    ...new Set(
      result.entities
        .filter(
          (entity) =>
            !(
              allowResolvedRisk &&
              entity.type === "Risk" &&
              entity.status === "deprecated"
            ),
        )
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
  const allEntityById = new Map(
    knowledgeGraph.entities.map((entity) => [entity.id, entity]),
  );
  const activeEntityById = new Map(
    knowledgeGraph.entities
      .filter((entity) => entity.status !== "deprecated")
      .map((entity) => [entity.id, entity]),
  );
  const connectedEntityIds = new Set<string>();
  const danglingRelationIds: string[] = [];
  const invalidDirectionRelationIds: string[] = [];

  for (const relation of knowledgeGraph.relations) {
    const source = allEntityById.get(relation.source);
    const target = allEntityById.get(relation.target);
    if (!source || !target) {
      danglingRelationIds.push(relation.id);
      continue;
    }
    if (!activeEntityById.has(source.id) || !activeEntityById.has(target.id)) {
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
  if (
    exact &&
    areKnowledgeGraphItemsSimilar(entity, exact, "entity") &&
    exact.status === entity.status &&
    exact.deprecated_by_task_id === entity.deprecated_by_task_id &&
    exact.replacement_node_id === entity.replacement_node_id
  ) {
    return exact;
  }

  const expectedSource = entity.source_task_id ?? taskId;
  return (
    graphIndexes.entities.find(
      (candidate) =>
        candidate.id !== entity.id &&
        candidate.source_task_id === expectedSource &&
        candidate.status === entity.status &&
        candidate.deprecated_by_task_id === entity.deprecated_by_task_id &&
        candidate.replacement_node_id === entity.replacement_node_id &&
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
    input.knowledgeGraph,
    input.plan,
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
  const retainedPriorIssues = (input.priorIssues ?? []).filter(
    (issue) => !isPriorIssueClosed(issue, review, input.knowledgeGraph),
  );
  const reviewIssues = mergeReviewIssues([
    ...retainedPriorIssues,
    ...validationReport.issues,
    ...review.review.issues,
  ]);
  const graphIssues = mergeReviewIssues([
    ...retainedPriorIssues,
    ...validationReport.issues,
    ...review.knowledge_graph_review.issues,
  ]);
  const hasError = [...reviewIssues, ...graphIssues].some(
    (issue) => issue.severity === "error",
  );
  const unresolvedBlockingQuestionCount = input.knowledgeGraph.open_questions.filter(
    (question) => question.blocking,
  ).length;
  const needsConfirmation =
    proposalQuestions.length > 0 ||
    rejectedTaskIds.length > 0 ||
    retryTaskIds.length > 0 ||
    hasError ||
    unresolvedBlockingQuestionCount > 0;

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
      ? unresolvedBlockingQuestionCount > 0 && proposalQuestions.length === 0
        ? `仍有 ${unresolvedBlockingQuestionCount} 个阻塞问题未关闭，本轮不能标记为完成。`
        : review.confirmation_message
      : `本轮任务已完成：${truncateText(review.product_context_update, 240)}`,
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
    const key = createReviewIssueKey(issue);
    const existing = merged.get(key);
    merged.set(key, {
      ...issue,
      severity:
        existing?.severity === "error" ? "error" : issue.severity,
    });
  }
  return [...merged.values()];
}

/**
 * 为跨轮 Critique 问题生成稳定键。
 */
function createReviewIssueKey(issue: CritiqueValidationIssue): string {
  return `${issue.code}|${issue.task_id ?? ""}`;
}

/**
 * 仅接受 Critique 明确声明的关闭；风险降级还必须引用图谱中的真实 Risk。
 */
function isPriorIssueClosed(
  issue: CritiqueValidationIssue,
  review: CritiqueAgentOutput,
  knowledgeGraph: ProductKnowledgeGraph,
): boolean {
  const resolution = (review.prior_issue_resolutions ?? []).find(
    (item) =>
      item.code === issue.code &&
      (item.task_id ?? "") === (issue.task_id ?? ""),
  );
  if (!resolution) return false;
  if (resolution.disposition === "resolved") return true;
  return Boolean(
    resolution.risk_id &&
      knowledgeGraph.risks.some((risk) => risk.id === resolution.risk_id),
  );
}

/**
 * 只接受能追溯到真实 blocking OpenQuestion 的模型问题，并补齐模型遗漏的问题。
 */
export function reconcileProposalQuestions(
  reviewQuestions: CritiqueAgentOutput["proposal_questions"],
  executorResults: ExecutorAgentResult[],
  knowledgeGraph?: ProductKnowledgeGraph,
  plan?: TaskExecutionPlan,
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
  for (const question of createFallbackGraphProposalQuestions(
    knowledgeGraph,
    plan,
    executorResults,
  )) {
    for (const source of question.sources) {
      actualSources.set(formatQuestionSourceKey(source), {
        required: question.required,
        priority: question.priority,
      });
    }
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

  const missing = [
    ...createFallbackProposalQuestions(executorResults),
    ...createFallbackGraphProposalQuestions(knowledgeGraph, plan, executorResults),
  ].flatMap(
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
    ...createFallbackGraphProposalQuestions(
      input.knowledgeGraph,
      input.plan,
      input.executorResults,
    ),
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
 * Executor 结果已被 supplement 轮次替换时，从累计图谱补齐仍真实存在的阻塞问题。
 */
function createFallbackGraphProposalQuestions(
  knowledgeGraph: ProductKnowledgeGraph | undefined,
  plan: TaskExecutionPlan | undefined,
  executorResults: ExecutorAgentResult[],
): CritiqueAgentOutput["proposal_questions"] {
  if (!knowledgeGraph) return [];
  const executorQuestionIds = new Set(
    executorResults.flatMap((result) =>
      result.open_questions.map((question) => question.id),
    ),
  );
  const sourceAgentByTask = new Map<
    string,
    ProductWorkflowProposalQuestion["sources"][number]["source_agent"]
  >([
    ...executorResults.map(
      (result) => [result.task_id, result.agent_type] as const,
    ),
    ...(plan?.tasks ?? []).map(
      (task) => [task.task_id, task.assigned_agent] as const,
    ),
  ]);

  return knowledgeGraph.open_questions.flatMap((question, index) => {
    if (!question.blocking || executorQuestionIds.has(question.id)) return [];
    const fallbackTask = plan?.tasks[0];
    const sourceTaskId =
      question.source_task_id ?? fallbackTask?.task_id ?? "unknown-task";
    const sourceAgent =
      question.source_agent ??
      sourceAgentByTask.get(sourceTaskId) ??
      fallbackTask?.assigned_agent ??
      "critique";

    return [
      {
        id: `${sourceTaskId}-${question.id}`,
        label: formatFallbackOpenQuestionLabel(question.text, sourceTaskId),
        type: "textarea" as const,
        required: true,
        placeholder: "请补充这个问题所需的事实、约束或偏好。",
        source_task_id: sourceTaskId,
        source_agent: sourceAgent,
        sources: [
          {
            source_task_id: sourceTaskId,
            source_agent: sourceAgent,
            open_question_id: question.id,
          },
        ],
        priority: 100 - index,
      },
    ];
  });
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
