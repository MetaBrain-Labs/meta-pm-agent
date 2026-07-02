/**
 * 产品工作流上下文压缩工具
 *
 * 为 Planner、Executor 和知识图谱工具生成可控大小的图谱摘要、任务相关子图、
 * 精简计划和精简历史结果。这里不改变持久化的完整结构，只控制传给模型的上下文形态。
 *
 * Responsibilities:
 * - 生成知识图谱的全局轻量摘要
 * - 按当前任务依赖和来源任务筛选相关子图
 * - 压缩 Planner 计划、Request 分析、用户输入和历史 Executor 结果
 *
 * Notes:
 * - 该模块只做确定性裁剪，不负责语义检索或向量召回。
 */

import type {
  ExecutorAgentResult,
  ProductKnowledgeGraph,
  RequestAnalysis,
  TaskExecutionNode,
  TaskExecutionPlan,
} from "@repo/shared";
import type { UserInputRecord } from "../../request/user-input";

const MAX_RELEVANT_NODES = 16;
const MAX_RELEVANT_RELATIONS = 16;
const MAX_SOURCE_TASK_ITEMS = 8;
const MAX_PREVIOUS_RESULTS = 12;
const MAX_USER_INPUT = 8;
const MAX_TEXT_LENGTH = 600;

/**
 * 生成适合默认注入模型 payload 的知识图谱摘要。
 */
export function createGraphContextSummary(
  knowledgeGraph: ProductKnowledgeGraph,
) {
  return {
    counts: {
      entities: knowledgeGraph.entities.length,
      relations: knowledgeGraph.relations.length,
    },
    recent_nodes: takeTail(knowledgeGraph.entities, 6).map((entity) => ({
      id: entity.id,
      type: entity.type,
      name: truncateText(entity.name),
      source_task_id: entity.source_task_id,
      status: entity.status,
    })),
  };
}

/**
 * 为当前 Executor 任务筛选依赖任务和关键词相关的图谱子集。
 */
export function createTaskRelevantGraphContext({
  knowledgeGraph,
  task,
  previousResults,
}: {
  knowledgeGraph: ProductKnowledgeGraph;
  task: TaskExecutionNode;
  previousResults: ExecutorAgentResult[];
}) {
  const sourceTaskIds = new Set([task.task_id, ...task.depends_on]);
  const dependencyResultTaskIds = new Set(task.depends_on);
  const keywords = extractKeywords(
    [task.title, task.description, task.expected_output].join(" "),
  );
  const relevantNodes = selectRelevantNodes(
    knowledgeGraph,
    sourceTaskIds,
    keywords,
  );
  const relevantNodeIds = new Set(relevantNodes.map((node) => node.id));
  const relevantRelations = selectRelevantRelations(
    knowledgeGraph,
    sourceTaskIds,
    relevantNodeIds,
    keywords,
  );

  return {
    dependency_task_ids: task.depends_on,
    dependency_results: previousResults
      .filter((result) => dependencyResultTaskIds.has(result.task_id))
      .map(compactExecutorResult),
    nodes: relevantNodes.map((node) => ({
      id: node.id,
      type: node.type,
      name: truncateText(node.name),
      description: truncateText(node.description ?? ""),
      source_task_id: node.source_task_id,
      status: node.status,
    })),
    relations: relevantRelations.map((relation) => ({
      id: relation.id,
      type: relation.type,
      source: relation.source,
      target: relation.target,
      description: truncateText(relation.description ?? ""),
      source_task_id: relation.source_task_id,
    })),
  };
}

/**
 * 压缩 Planner DAG，只保留 Executor 判断依赖关系所需字段。
 */
export function compactTaskExecutionPlan(plan: TaskExecutionPlan) {
  return {
    request_summary: truncateText(plan.request_summary),
    dag: plan.dag,
    tasks: plan.tasks.map((task) => ({
      task_id: task.task_id,
      sequence: task.sequence,
      title: truncateText(task.title),
      assigned_agent: task.assigned_agent,
      depends_on: task.depends_on,
      covered_business_model_indexes: task.covered_business_model_indexes,
      expected_output: truncateText(task.expected_output),
    })),
    assumptions: takeTail(plan.assumptions, 4).map((assumption) =>
      truncateText(assumption),
    ),
  };
}

/**
 * 压缩历史 Executor 结果，避免把完整节点和关系再次注入后续 Executor。
 */
export function compactPreviousExecutorResults(
  results: ExecutorAgentResult[],
) {
  return takeTail(results, MAX_PREVIOUS_RESULTS).map(compactExecutorResult);
}

/**
 * 仅保留当前任务覆盖的 Request Agent 分析条目。
 */
export function compactRequestAnalysisForTask(
  analysis: RequestAnalysis,
  task: TaskExecutionNode,
): RequestAnalysis {
  const coveredIndexes = new Set(task.covered_business_model_indexes);
  const businessModel = analysis.business_model
    .filter((item) => coveredIndexes.has(item.index))
    .map((item) => ({
      ...item,
      user_goal: truncateText(item.user_goal),
      goal_constraints: item.goal_constraints
        .slice(0, 6)
        .map((constraint) => truncateText(constraint)),
      missing_information: item.missing_information.slice(0, 3).map((info) => ({
        ...info,
        description: truncateText(info.description),
      })),
    }));

  return {
    business_model:
      businessModel.length > 0
        ? businessModel
        : analysis.business_model.slice(0, 3),
    questions: analysis.questions,
    chitchat: analysis.chitchat,
  };
}

/**
 * 按当前任务关联的用户输入索引压缩原始用户输入。
 */
export function compactUserInputForTask({
  analysis,
  task,
  userInput,
}: {
  analysis: RequestAnalysis;
  task: TaskExecutionNode;
  userInput: UserInputRecord[];
}) {
  const relatedBusinessIndexes = new Set(task.covered_business_model_indexes);
  const relatedInputIndexes = new Set(
    analysis.business_model
      .filter((item) => relatedBusinessIndexes.has(item.index))
      .flatMap((item) => item.covered_user_input_indexes),
  );
  const selected = userInput.filter((item) =>
    relatedInputIndexes.has(item.index),
  );

  return (selected.length > 0 ? selected : userInput)
    .slice(0, MAX_USER_INPUT)
    .map((item) => ({
      ...item,
      content: truncateText(item.content),
    }));
}

/**
 * 按来源任务 ID 读取任务增量，供工具查询复用。
 */
export function readGraphBySourceTasks(
  knowledgeGraph: ProductKnowledgeGraph,
  sourceTaskIds: string[],
  limit = MAX_SOURCE_TASK_ITEMS,
) {
  const sourceTaskIdSet = new Set(sourceTaskIds);
  const nodes = knowledgeGraph.entities.filter((entity) =>
    entity.source_task_id ? sourceTaskIdSet.has(entity.source_task_id) : false,
  );
  const nodeIds = new Set(nodes.map((node) => node.id));

  return {
    source_task_ids: sourceTaskIds,
    nodes: nodes.slice(0, limit),
    relations: knowledgeGraph.relations
      .filter(
        (relation) =>
          (relation.source_task_id &&
            sourceTaskIdSet.has(relation.source_task_id)) ||
          nodeIds.has(relation.source) ||
          nodeIds.has(relation.target),
      )
      .slice(0, limit),
  };
}

/**
 * 生成历史结果的一行摘要。
 */
function compactExecutorResult(result: ExecutorAgentResult) {
  return {
    task_id: result.task_id,
    agent_type: result.agent_type,
    summary: truncateText(result.summary, 240),
    top_node_ids: result.entities.slice(0, 3).map((entity) => entity.id),
  };
}

/**
 * 按来源任务和关键词选择相关节点。
 */
function selectRelevantNodes(
  knowledgeGraph: ProductKnowledgeGraph,
  sourceTaskIds: Set<string>,
  keywords: string[],
) {
  const matched = knowledgeGraph.entities.filter((entity) => {
    if (entity.source_task_id && sourceTaskIds.has(entity.source_task_id)) {
      return true;
    }
    return matchesKeywords(
      [entity.id, entity.type, entity.name, entity.description ?? ""].join(" "),
      keywords,
    );
  });

  return (matched.length > 0 ? matched : takeTail(knowledgeGraph.entities, 6))
    .slice(0, MAX_RELEVANT_NODES);
}

/**
 * 按来源任务、端点节点和关键词选择相关关系。
 */
function selectRelevantRelations(
  knowledgeGraph: ProductKnowledgeGraph,
  sourceTaskIds: Set<string>,
  nodeIds: Set<string>,
  keywords: string[],
) {
  const matched = knowledgeGraph.relations.filter((relation) => {
    if (
      relation.source_task_id &&
      sourceTaskIds.has(relation.source_task_id)
    ) {
      return true;
    }
    if (nodeIds.has(relation.source) || nodeIds.has(relation.target)) {
      return true;
    }
    return matchesKeywords(
      [
        relation.id,
        relation.type,
        relation.description ?? "",
        relation.source,
        relation.target,
      ].join(" "),
      keywords,
    );
  });

  return matched.slice(0, MAX_RELEVANT_RELATIONS);
}

/**
 * 提取英文和数字关键词；中文场景主要依赖来源任务 ID 做精确裁剪。
 */
function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "task",
    "agent",
  ]);
  return [
    ...new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9_-]{2,}/g)
        ?.filter((word) => !stopwords.has(word)) ?? [],
    ),
  ].slice(0, 24);
}

/**
 * 判断文本是否包含任一关键词。
 */
function matchesKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

/**
 * 截断长文本，控制模型输入体积。
 */
function truncateText(text: string, maxLength = MAX_TEXT_LENGTH): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

/**
 * 取数组尾部，保留最近写入的上下文。
 */
function takeTail<T>(items: T[], limit: number): T[] {
  return items.slice(Math.max(0, items.length - limit));
}
