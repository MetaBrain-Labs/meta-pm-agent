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
import { CRITIQUE_AGENT_PROMPT } from "./prompt";
import { createExactCritiqueValidationReport } from "./validation";

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
    stale_deprecated_downstream_node_ids: string[];
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
    workflow_purpose: input.workflowPurpose ?? "standard",
    product_context: truncateText(
      input.productContext || "No product context provided.",
      800,
    ),
    request_analysis: compactRequestAnalysisForReview(input.requestAnalysis),
    user_input: (input.userInput ?? []).map((item) => ({
      index: item.index,
      type: item.type,
      // 表单答案是语义审查的权威来源，不能只保留前几个答案。
      content: truncateText(item.content, 2400),
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
  return createExactCritiqueValidationReport(input);
}

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
  const requiresExecutorRetry =
    rejectedTaskIds.length > 0 || retryTaskIds.length > 0 || hasError;
  const needsConfirmation =
    proposalQuestions.length > 0 || unresolvedBlockingQuestionCount > 0;

  return {
    status: requiresExecutorRetry
      ? "requires_executor_retry"
      : needsConfirmation
        ? "pending_user_confirmation"
        : "completed",
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
    confirmation_message: requiresExecutorRetry
      ? review.confirmation_message
      : needsConfirmation
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

  return ensureBlockingQuestionHelp(
    [...verified, ...missing].sort(
      (left, right) => right.priority - left.priority,
    ),
    executorResults,
    plan,
  );
}

/**
 * 为阻断问题补齐用户可读资料，并把非结构化 help 归一为固定的两个展示段落。
 */
function ensureBlockingQuestionHelp(
  questions: ProductWorkflowProposalQuestion[],
  executorResults: ExecutorAgentResult[],
  plan?: TaskExecutionPlan,
): ProductWorkflowProposalQuestion[] {
  const resultByTaskId = new Map(
    executorResults.map((result) => [result.task_id, result]),
  );
  const taskById = new Map(
    (plan?.tasks ?? []).map((task) => [task.task_id, task]),
  );

  return questions.map((question) => {
    if (!question.required) return question;
    const existingHelp = question.help?.trim();
    if (
      existingHelp?.includes("当前已知资料：") &&
      existingHelp.includes("阻断原因：")
    ) {
      return { ...question, help: existingHelp };
    }

    const sources =
      question.sources.length > 0
        ? question.sources
        : question.source_task_id
          ? [
              {
                source_task_id: question.source_task_id,
                source_agent: question.source_agent ?? ("critique" as const),
              },
            ]
          : [];
    const context = mergeTextList(
      sources.flatMap((source) => {
        const result = resultByTaskId.get(source.source_task_id);
        const task = taskById.get(source.source_task_id);
        return [
          ...(result?.summary ? [truncateText(result.summary, 240)] : []),
          ...(task
            ? [truncateText(`${task.title}：${task.expected_output}`, 240)]
            : []),
        ];
      }),
    ).slice(0, 3);

    return {
      ...question,
      help: [
        `当前已知资料：${existingHelp || context.join("；") || "暂无更多已确认资料。"}`,
        `阻断原因：${question.label}`,
      ].join("\n"),
    };
  });
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
  const proposalQuestions = ensureBlockingQuestionHelp(
    [
      ...(retryQuestion ? [retryQuestion] : []),
      ...createFallbackProposalQuestions(input.executorResults),
      ...createFallbackGraphProposalQuestions(
        input.knowledgeGraph,
        input.plan,
        input.executorResults,
      ),
    ],
    input.executorResults,
    input.plan,
  );
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
  const resolvedQuestionIds = new Set(
    knowledgeGraph.resolved_open_question_ids ?? [],
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
    if (
      !question.blocking ||
      executorQuestionIds.has(question.id) ||
      resolvedQuestionIds.has(question.id)
    ) {
      return [];
    }
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
