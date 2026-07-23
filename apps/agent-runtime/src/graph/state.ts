/**
 * LangGraph 公共状态定义
 *
 * 使用 @langchain/langgraph 的 Annotation API 定义产品工作流图的所有跨节点共享状态字段，
 * 包括用户输入、请求分析、任务计划、执行结果、知识图谱等。
 *
 * Responsibilities:
 * - 定义 WorkflowGraphState 及其类型 WorkflowGraphStateValue
 * - 为每个状态字段配置 reducer 和默认值
 * - 作为所有图节点间数据传递的契约
 *
 * Notes:
 * - 后续新增 Agent 节点时，在此文件中扩展共享状态字段
 */

import { Annotation } from "@langchain/langgraph";
import type {
  ExecutorAgentResult,
  OrchestratorAgentResult,
  OrchestratorContextSource,
  ProductKnowledgeGraph,
  ProductWorkflowResult,
  RequestAnalysis,
  TaskExecutionPlan,
} from "@repo/shared";
import { mergeProductKnowledgeGraphSnapshots } from "../agents/product-workflow/common/knowledge-graph-merge";
import type { UserInputRecord } from "../agents/request/user-input";
import type { ExecutorAgentType } from "../agents/product-workflow/executor-agent/definitions";
import type { CritiqueReviewIssue } from "../agents/product-workflow/types";

/**
 * 公共 LangGraph 状态。后续新增 Planner、QA 或模块 Agent 时，
 * 都应继续在这里扩展跨节点共享的状态字段。
 */
export const WorkflowGraphState = Annotation.Root({
  // API 读取工作区概述性文档后注入，可为空。
  productContext: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),

  // 当前会话所属工作区 ID，用于隔离运行时知识图谱文件。
  workspaceId: Annotation<string | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
  }),

  // 当前产品上下文的加载来源，供 Orchestrator 区分 resources、数据库或空上下文。
  contextSource: Annotation<OrchestratorContextSource>({
    reducer: (_current, update) => update,
    default: () => "none",
  }),

  // Conversation Agent 输出的原始 <user-input> 内容。
  userInputBlock: Annotation<string>(),

  // 解析后的独立语句列表，供 Request Agent 及后续 Agent 使用。
  userInput: Annotation<UserInputRecord[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),

  // Request Agent 的结构化分类结果。
  requestAnalysis: Annotation<RequestAnalysis | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  // 沿用现有 SSE/消息内容中的 tagged block 传输方式。
  requestAnalysisBlock: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),

  // Orchestrator Agent 的顶层路由决策，后续节点只消费该结构化结果。
  orchestratorDecision: Annotation<OrchestratorAgentResult | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  // 当前产品知识图谱快照，供 Planner 和 Executor 共享上下文。
  knowledgeGraph: Annotation<ProductKnowledgeGraph | null>({
    reducer: mergeKnowledgeGraphSnapshots,
    default: () => null,
  }),

  // Orchestrator 内 Planner SubAgent 生成的 DAG，后续 Executor 节点按该计划执行。
  plan: Annotation<TaskExecutionPlan | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  // Question Form 恢复时仅允许 Planner 为受影响的 Executor 生成补充任务。
  supplementAgentTypes: Annotation<ExecutorAgentType[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),

  // 用户已通过 Critique 表单回答的问题，Supplement Planner 不得重新创建。
  answeredOpenQuestionIds: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),

  // Executor Agent 对 Planner DAG 中每个任务的结构化产出。
  executorResults: Annotation<ExecutorAgentResult[]>({
    reducer: mergeExecutorResults,
    default: () => [],
  }),

  // Supplement 轮次继承历史 Critique 未关闭问题，避免只审当前 DAG。
  priorCritiqueIssues: Annotation<CritiqueReviewIssue[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),

  // Critique Agent 对 Planner SubAgent 计划和 Executor 结果的最终汇总。
  productWorkflow: Annotation<ProductWorkflowResult | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

export type WorkflowGraphStateValue = typeof WorkflowGraphState.State;

/**
 * 合并并行 Executor 返回的结果，按 task_id 保持幂等。
 */
function mergeExecutorResults(
  current: ExecutorAgentResult[],
  update: ExecutorAgentResult[],
): ExecutorAgentResult[] {
  // 新一轮恢复运行需要用空数组显式清理旧 checkpoint 中的 Executor 结果。
  if (update.length === 0) return [];

  const merged = new Map(current.map((item) => [item.task_id, item]));
  for (const item of update) {
    merged.set(item.task_id, item);
  }

  return [...merged.values()].sort(
    (left, right) =>
      getTaskSortValue(left.task_id) - getTaskSortValue(right.task_id),
  );
}

/**
 * 合并多个 Executor 基于同一图谱快照产出的完整快照，避免并行写覆盖。
 */
export function mergeKnowledgeGraphSnapshots(
  current: ProductKnowledgeGraph | null,
  update: ProductKnowledgeGraph | null,
): ProductKnowledgeGraph | null {
  // 工作区图谱被重置时，不能继续沿用旧 checkpoint 中的图谱快照。
  if (update === null) return null;
  if (!current) return update;

  return mergeProductKnowledgeGraphSnapshots(current, update);
}

/**
 * 从 task_id 中提取排序数字，无法提取时保持在尾部。
 */
function getTaskSortValue(taskId: string): number {
  const match = taskId.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}
