/**
 * Critique 确定性校验
 *
 * 仅校验无需自然语言理解即可证明的工作流不变式。业务产物等价性、指标语义、
 * 交付链完整性与重复概念判断必须留给 Critique Agent。
 *
 * Responsibilities:
 * - 校验任务身份、Executor 类型授权和必填数量
 * - 校验提交结果、来源引用、关系端点与关系方向
 * - 生成可供模型审查和重试决策消费的精确错误报告
 *
 * Notes:
 * - 不使用关键词词典、文本相似度或自由文本 expected_output 推断。
 */

import type {
  CritiqueAgentOutput,
  ExecutorAgentResult,
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
  ProductKnowledgeGraph,
} from "@repo/shared";
import { isKnowledgeGraphRelationDirectionValid } from "../common/knowledge-graph";
import { areKnowledgeGraphItemsSimilar } from "../common/knowledge-graph-merge";
import {
  getExecutorDefinition,
  isExecutorAgentType,
} from "../executor-agent/definitions";
import type { CritiqueAgentInput } from "../types";

export type CritiqueValidationIssue =
  CritiqueAgentOutput["review"]["issues"][number];

export interface ExecutorUpdateRecord {
  task_id: string;
  assigned_agent: string;
  actual_agent: string | null;
  status: "completed" | "missing";
  created_entity_ids: string[];
  created_relation_ids: string[];
  committed_entity_ids: string[];
  committed_relation_ids: string[];
  commit_status: "committed" | "partial" | "not_committed" | "not_attempted";
  validation_errors: CritiqueValidationIssue[];
}

export interface CritiqueValidationReport {
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
}

/** 创建只包含精确不变式的 Critique 校验报告。 */
export function createExactCritiqueValidationReport(
  input: CritiqueAgentInput,
): CritiqueValidationReport {
  const resultByTaskId = new Map(
    input.executorResults.map((result) => [result.task_id, result]),
  );
  const entityById = new Map(
    input.knowledgeGraph.entities.map((entity) => [entity.id, entity]),
  );
  const relationById = new Map(
    input.knowledgeGraph.relations.map((relation) => [relation.id, relation]),
  );
  const issues: CritiqueValidationIssue[] = [];
  const records: ExecutorUpdateRecord[] = [];

  for (const task of input.plan.tasks) {
    const result = resultByTaskId.get(task.task_id);
    if (!result) {
      const issue = createIssue(
        "MISSING_EXECUTOR_RESULT",
        "error",
        "Planned task has no executor result.",
        task.task_id,
      );
      issues.push(issue);
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
        validation_errors: [issue],
      });
      continue;
    }

    const commit = resolveExecutorCommit(result, input.knowledgeGraph);
    const taskIssues = validateTaskResult({
      input,
      result,
      assignedAgent: task.assigned_agent,
      requiredBlockingQuestionCount:
        task.required_open_question_count ??
        task.required_open_question_ids?.length ??
        0,
      entityById,
    });
    taskIssues.push(...commit.issues);
    if (result.entities.length > 8 || result.relations.length > 12) {
      taskIssues.push(
        createIssue(
          "TASK_PATCH_SIZE_EXCEEDED",
          "warning",
          `Task created ${result.entities.length} entities and ${result.relations.length} relations; the normal ceiling is 8 entities and 12 relations.`,
          task.task_id,
        ),
      );
    }

    records.push({
      task_id: task.task_id,
      assigned_agent: task.assigned_agent,
      actual_agent: result.agent_type,
      status: "completed",
      created_entity_ids: result.entities.map((item) => item.id),
      created_relation_ids: result.relations.map((item) => item.id),
      committed_entity_ids: commit.entityIds,
      committed_relation_ids: commit.relationIds,
      commit_status:
        commit.totalCount === 0 || !result.quality_result.passed
          ? "not_attempted"
          : commit.committedCount === commit.totalCount
            ? "committed"
            : commit.committedCount === 0
              ? "not_committed"
              : "partial",
      validation_errors: taskIssues,
    });
    issues.push(...taskIssues);
  }

  const graphIntegrity = inspectGraphIntegrity(input.knowledgeGraph);
  const currentRelationTaskById = new Map(
    records.flatMap((record) =>
      record.committed_relation_ids.map(
        (relationId) => [relationId, record.task_id] as const,
      ),
    ),
  );
  for (const relationId of graphIntegrity.dangling_relation_ids) {
    const taskId = currentRelationTaskById.get(relationId);
    issues.push(
      createIssue(
        taskId
          ? "RELATION_ENDPOINT_MISSING"
          : "LEGACY_RELATION_ENDPOINT_MISSING",
        taskId ? "error" : "warning",
        `Relation ${relationId} references a missing source or target node.`,
        taskId,
      ),
    );
  }
  for (const relationId of graphIntegrity.invalid_direction_relation_ids) {
    const taskId = currentRelationTaskById.get(relationId);
    issues.push(
      createIssue(
        taskId
          ? "INVALID_RELATION_DIRECTION"
          : "LEGACY_INVALID_RELATION_DIRECTION",
        taskId ? "error" : "warning",
        `Relation ${relationId} has an invalid source/target type direction.`,
        taskId,
      ),
    );
  }
  if (graphIntegrity.orphan_requirement_ids.length > 0) {
    issues.push(
      createIssue(
        "ORPHAN_REQUIREMENT",
        "warning",
        `Requirement nodes have no relations: ${formatIds(graphIntegrity.orphan_requirement_ids)}.`,
      ),
    );
  }
  if (graphIntegrity.orphan_feature_ids.length > 0) {
    issues.push(
      createIssue(
        "ORPHAN_FEATURE",
        "warning",
        `Feature nodes have no relations: ${formatIds(graphIntegrity.orphan_feature_ids)}.`,
      ),
    );
  }

  const rejectedTaskIds = Array.from(
    new Set(
      issues
        .filter((issue) => issue.severity === "error" && issue.task_id)
        .map((issue) => issue.task_id!),
    ),
  );
  const rejected = new Set(rejectedTaskIds);
  return {
    accepted_task_ids: input.plan.tasks
      .map((task) => task.task_id)
      .filter((taskId) => !rejected.has(taskId)),
    rejected_task_ids: rejectedTaskIds,
    retry_task_ids: rejectedTaskIds,
    issues,
    executor_update_records: records,
    graph_integrity: graphIntegrity,
    semantic_integrity: {
      stale_deprecated_downstream_node_ids: [],
      untraceable_node_ids: [],
      unverified_evidence_ids: [],
      broken_delivery_chain_requirement_ids: [],
      missing_supplement_metric_requirement_ids: [],
      unresolved_blocking_question_ids: input.knowledgeGraph.open_questions
        .filter((question) => question.blocking)
        .map((question) => question.id),
    },
  };
}

function validateTaskResult({
  input,
  result,
  assignedAgent,
  requiredBlockingQuestionCount,
  entityById,
}: {
  input: CritiqueAgentInput;
  result: ExecutorAgentResult;
  assignedAgent: string;
  requiredBlockingQuestionCount: number;
  entityById: Map<string, KnowledgeGraphEntity>;
}): CritiqueValidationIssue[] {
  const issues: CritiqueValidationIssue[] = [];
  if (result.agent_type !== assignedAgent) {
    issues.push(
      createIssue(
        "AGENT_TYPE_MISMATCH",
        "error",
        `Task assigned to ${assignedAgent} but result came from ${result.agent_type}.`,
        result.task_id,
      ),
    );
  }
  if (isExecutorAgentType(assignedAgent)) {
    const definition = getExecutorDefinition(assignedAgent);
    for (const entity of result.entities) {
      if (
        input.plan.status === "supplement" &&
        entity.type === "OpenQuestion" &&
        entity.status === "deprecated"
      ) {
        continue;
      }
      if (
        input.documentEvidenceResolution === true &&
        entity.type === "Risk" &&
        entity.status === "deprecated"
      ) {
        continue;
      }
      if (!definition.allowedEntityTypes.includes(entity.type as never)) {
        issues.push(
          createIssue(
            "UNAUTHORIZED_ENTITY_TYPE",
            "error",
            `${assignedAgent} is not allowed to create ${entity.type} entities.`,
            result.task_id,
          ),
        );
      }
    }
    for (const type of new Set(result.relations.map((relation) => relation.type))) {
      if (
        type !== "Custom" &&
        !definition.allowedRelationTypes.includes(type as never)
      ) {
        issues.push(
          createIssue(
            "UNAUTHORIZED_RELATION_TYPE",
            "error",
            `${assignedAgent} is not allowed to create ${type} relations.`,
            result.task_id,
          ),
        );
      }
    }
  }

  const blockingCount = result.open_questions.filter(
    (question) => question.blocking,
  ).length;
  if (blockingCount < requiredBlockingQuestionCount) {
    issues.push(
      createIssue(
        "MISSING_REQUIRED_BLOCKING_QUESTIONS",
        "error",
        `Task persisted ${blockingCount} blocking OpenQuestions but requires ${requiredBlockingQuestionCount}.`,
        result.task_id,
      ),
    );
  }

  for (const entity of result.entities) {
    if (entity.status !== "deprecated" && !entity.provenance?.length) {
      issues.push(
        createIssue(
          "UNTRACEABLE_NODE_PROVENANCE",
          "error",
          `New active node ${entity.id} has no provenance.`,
          result.task_id,
        ),
      );
    }
    if (
      entity.status !== "deprecated" &&
      entity.type === "Evidence" &&
      !entity.provenance?.some(
        (source) =>
          source.kind === "user_input" || source.kind === "web_search",
      )
    ) {
      issues.push(
        createIssue(
          "UNVERIFIED_EVIDENCE_SOURCE",
          "error",
          `Evidence ${entity.id} is not backed by explicit user input or a verified web-search source.`,
          result.task_id,
        ),
      );
    }
    for (const source of entity.provenance ?? []) {
      if (
        source.kind === "existing_graph" &&
        source.node_id &&
        !entityById.has(source.node_id)
      ) {
        issues.push(
          createIssue(
            "PROVENANCE_REFERENCE_MISSING",
            "error",
            `Entity ${entity.id} references missing provenance node ${source.node_id}.`,
            result.task_id,
          ),
        );
      }
    }
  }
  return issues;
}

function resolveExecutorCommit(
  result: ExecutorAgentResult,
  graph: ProductKnowledgeGraph,
): {
  issues: CritiqueValidationIssue[];
  entityIds: string[];
  relationIds: string[];
  committedCount: number;
  totalCount: number;
} {
  const issues: CritiqueValidationIssue[] = [];
  const entityIdMap = new Map<string, string>();
  const entityIds: string[] = [];
  const relationIds: string[] = [];
  let committedCount = 0;
  const totalCount =
    result.entities.length +
    result.relations.length +
    result.decisions.length +
    result.risks.length +
    result.open_questions.length;

  for (const entity of result.entities) {
    const committed = findCommittedEntity(entity, result.task_id, graph.entities);
    if (!committed) {
      issues.push(
        createIssue(
          "ENTITY_NOT_COMMITTED",
          "error",
          `Entity ${entity.id} exists in executor output but not in final graph.`,
          result.task_id,
        ),
      );
      continue;
    }
    entityIdMap.set(entity.id, committed.id);
    entityIds.push(committed.id);
    committedCount += 1;
  }
  for (const relation of result.relations) {
    const committed = findCommittedRelation(
      relation,
      result.task_id,
      graph.relations,
      entityIdMap,
    );
    if (!committed) {
      issues.push(
        createIssue(
          "RELATION_NOT_COMMITTED",
          "error",
          `Relation ${relation.id} exists in executor output but not in final graph.`,
          result.task_id,
        ),
      );
      continue;
    }
    relationIds.push(committed.id);
    committedCount += 1;
  }
  for (const [items, storedItems] of [
    [result.decisions, graph.decisions],
    [result.risks, graph.risks],
    [result.open_questions, graph.open_questions],
  ] as const) {
    for (const item of items) {
      if (findCommittedAuxiliaryItem(item, result.task_id, storedItems)) {
        committedCount += 1;
      } else {
        issues.push(
          createIssue(
            "AUXILIARY_ITEM_NOT_COMMITTED",
            "error",
            `Auxiliary graph item ${item.id} exists in executor output but not in final graph.`,
            result.task_id,
          ),
        );
      }
    }
  }
  if (totalCount === 0) {
    issues.push(
      createIssue(
        "NO_STRUCTURED_GRAPH_PATCH",
        "error",
        "Executor result contains no structured graph patch items.",
        result.task_id,
      ),
    );
  }
  return { issues, entityIds, relationIds, committedCount, totalCount };
}

function findCommittedEntity(
  entity: KnowledgeGraphEntity,
  taskId: string,
  candidates: KnowledgeGraphEntity[],
): KnowledgeGraphEntity | null {
  const exact = candidates.find((candidate) => candidate.id === entity.id);
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
    candidates.find(
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

function findCommittedRelation(
  relation: KnowledgeGraphRelation,
  taskId: string,
  candidates: KnowledgeGraphRelation[],
  entityIdMap: Map<string, string>,
): KnowledgeGraphRelation | null {
  const remapped = {
    ...relation,
    source: entityIdMap.get(relation.source) ?? relation.source,
    target: entityIdMap.get(relation.target) ?? relation.target,
  };
  const exact = candidates.find((candidate) => candidate.id === relation.id);
  if (exact && areKnowledgeGraphItemsSimilar(remapped, exact, "relation")) {
    return exact;
  }
  const expectedSource = relation.source_task_id ?? taskId;
  return (
    candidates.find(
      (candidate) =>
        candidate.id !== relation.id &&
        candidate.source_task_id === expectedSource &&
        areKnowledgeGraphItemsSimilar(remapped, candidate, "relation"),
    ) ?? null
  );
}

function findCommittedAuxiliaryItem<
  T extends { id: string; text: string; source_task_id?: string },
>(item: T, taskId: string, candidates: readonly T[]): T | null {
  const exact = candidates.find((candidate) => candidate.id === item.id);
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

function inspectGraphIntegrity(
  graph: ProductKnowledgeGraph,
): CritiqueValidationReport["graph_integrity"] {
  const entityById = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const connected = new Set<string>();
  const dangling: string[] = [];
  const invalidDirections: string[] = [];
  for (const relation of graph.relations) {
    const source = entityById.get(relation.source);
    const target = entityById.get(relation.target);
    if (!source || !target) {
      dangling.push(relation.id);
      continue;
    }
    if (source.status === "deprecated" || target.status === "deprecated") continue;
    connected.add(source.id);
    connected.add(target.id);
    if (
      !isKnowledgeGraphRelationDirectionValid(
        relation.type,
        source.type,
        target.type,
      )
    ) {
      invalidDirections.push(relation.id);
    }
  }
  return {
    dangling_relation_ids: dangling,
    invalid_direction_relation_ids: invalidDirections,
    orphan_requirement_ids: graph.entities
      .filter(
        (entity) =>
          entity.type === "Requirement" &&
          entity.status !== "deprecated" &&
          !connected.has(entity.id),
      )
      .map((entity) => entity.id),
    orphan_feature_ids: graph.entities
      .filter(
        (entity) =>
          entity.type === "Feature" &&
          entity.status !== "deprecated" &&
          !connected.has(entity.id),
      )
      .map((entity) => entity.id),
  };
}

function createIssue(
  code: string,
  severity: "warning" | "error",
  message: string,
  taskId?: string,
): CritiqueValidationIssue {
  return {
    code,
    severity,
    message,
    ...(taskId ? { task_id: taskId } : {}),
  };
}

function formatIds(ids: string[]): string {
  return `${ids.slice(0, 8).join(", ")}${ids.length > 8 ? ` and ${ids.length - 8} more` : ""}`;
}
