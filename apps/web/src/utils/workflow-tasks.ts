/**
 * 工作流任务状态推导
 *
 * 从 Planner 计划与 Executor 结果推导每个 DAG 节点的状态，并计算可展示的执行
 * 层级与图谱更新统计，供项目面板的「任务历史」使用。
 *
 * Responsibilities:
 * - 归一化节点状态：已完成 / 运行中 / 等待 / 失败
 * - 按依赖关系计算执行层级（同层可并行）
 * - 汇总本次任务的实体与关系变更
 *
 * Notes:
 * - 纯计算模块：不读取消息、不发起请求、不修改任何运行状态。
 * - 状态只由"已有结果 + 当前运行中的 Agent"推导，不新增工作流字段。
 * - AGENT_LABELS 与 PlannerExecutionCard 内的同名映射保持一致；对话内卡片仍保留
 *   自己的渲染逻辑，本模块不反向依赖组件。
 */

import type {
  ExecutorAgentResult,
  ProductWorkflowAgentType,
  TaskExecutionNode,
} from "../types";

/** DAG 节点在界面上的状态。 */
export type TaskNodeStatus = "completed" | "running" | "waiting" | "failed";

/** 各 Agent 的展示名称。 */
const AGENT_LABELS: Record<string, string> = {
  "executor-product-strategy": "Product Strategy Executor",
  "executor-market-research": "Market Research Executor",
  "executor-gtm": "Go-to-Market Executor",
  "executor-product-discovery": "Product Discovery Executor",
  "executor-product-execution": "Product Execution Executor",
  "executor-marketing-growth": "Marketing Growth Executor",
  "executor-data-analytics": "Data Analytics Executor",
  "executor-ai-shipping": "AI Shipping Executor",
  "executor-toolkit": "Toolkit Executor",
  "executor-interface-craft": "Interface Craft Executor",
};

/** 将 Agent 类型转换为展示名。 */
export function getAgentLabel(agentType: ProductWorkflowAgentType): string {
  return AGENT_LABELS[agentType] ?? agentType;
}

/**
 * 根据已完成结果和当前 Agent 推断每个任务的状态。
 *
 * failedTaskIds 由调用方从错误信息中给出；没有该信息时不会出现失败态。
 */
export function buildTaskStatus(
  tasks: TaskExecutionNode[],
  results: ExecutorAgentResult[],
  activeAgent?: string,
  activeAgents?: string[],
  failedTaskIds: ReadonlySet<string> = new Set(),
): Map<string, TaskNodeStatus> {
  const completedTaskIds = new Set(results.map((item) => item.task_id));
  const runningAgents = new Set(activeAgents ?? []);
  if (activeAgent) runningAgents.add(activeAgent);
  const runningTaskIds = new Set<string>();

  // 相同 Executor 可能在 DAG 中出现多次，只标记当前依赖已满足的最早任务。
  for (const agentType of runningAgents) {
    const runningTask = tasks
      .filter((task) => task.assigned_agent === agentType)
      .sort((left, right) => left.sequence - right.sequence)
      .find(
        (task) =>
          !completedTaskIds.has(task.task_id) &&
          !failedTaskIds.has(task.task_id) &&
          task.depends_on.every((taskId) => completedTaskIds.has(taskId)),
      );
    if (runningTask) runningTaskIds.add(runningTask.task_id);
  }

  return new Map(
    tasks.map((task) => {
      if (completedTaskIds.has(task.task_id)) {
        return [task.task_id, "completed" as const];
      }
      if (failedTaskIds.has(task.task_id)) {
        return [task.task_id, "failed" as const];
      }
      if (runningTaskIds.has(task.task_id)) {
        return [task.task_id, "running" as const];
      }
      return [task.task_id, "waiting" as const];
    }),
  );
}

/**
 * 按 depends_on 把任务分成执行层级。
 *
 * 依赖数据存在时得到真正的分支结构（同层可并行）；数据异常出现环时，剩余任务
 * 追加到最后一层，保证展示不丢任务。
 */
export function buildTaskLayers(tasks: TaskExecutionNode[]): TaskExecutionNode[][] {
  const taskById = new Map(tasks.map((task) => [task.task_id, task]));
  const depthCache = new Map<string, number>();

  /** 计算某任务的层级；遇到环时返回 0，避免无限递归。 */
  const resolveDepth = (taskId: string, seen: Set<string>): number => {
    const cached = depthCache.get(taskId);
    if (cached !== undefined) return cached;
    if (seen.has(taskId)) return 0;
    const task = taskById.get(taskId);
    if (!task) return 0;

    const nextSeen = new Set(seen).add(taskId);
    const depth = task.depends_on
      .filter((dependency) => taskById.has(dependency))
      .reduce(
        (max, dependency) => Math.max(max, resolveDepth(dependency, nextSeen) + 1),
        0,
      );
    depthCache.set(taskId, depth);
    return depth;
  };

  const layers = new Map<number, TaskExecutionNode[]>();
  for (const task of tasks) {
    const depth = resolveDepth(task.task_id, new Set());
    const bucket = layers.get(depth);
    if (bucket) bucket.push(task);
    else layers.set(depth, [task]);
  }

  return [...layers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, layerTasks]) =>
      [...layerTasks].sort((left, right) => left.sequence - right.sequence),
    );
}

/** 合并各 Executor 结果的实体与关系，统计跨任务重复出现的条目。 */
export interface GraphUpdateSummary {
  /** 仅在一次任务结果中出现过的实体。 */
  newEntities: Array<Record<string, unknown>>;
  /** 在多次任务结果中出现过的实体。 */
  updatedEntities: Array<Record<string, unknown>>;
  newRelations: Array<Record<string, unknown>>;
  updatedRelations: Array<Record<string, unknown>>;
}

/**
 * 汇总本次任务的图谱更新内容。
 *
 * 口径说明：按实体/关系的业务 ID 统计——只在一个 Executor 结果里出现记为新增，
 * 被多个结果同时提交记为更新。这是对已有结果的统计，不推断图谱的真实写库结果。
 */
export function summarizeGraphUpdate(
  results: ExecutorAgentResult[],
): GraphUpdateSummary {
  const collect = (key: "entities" | "relations") => {
    const seen = new Map<string, { record: Record<string, unknown>; count: number }>();
    for (const result of results) {
      for (const [index, record] of (result[key] ?? []).entries()) {
        const id = readIdentity(record, index, key);
        const existing = seen.get(id);
        if (existing) existing.count += 1;
        else seen.set(id, { record, count: 1 });
      }
    }
    const isNew: Array<Record<string, unknown>> = [];
    const isUpdated: Array<Record<string, unknown>> = [];
    for (const entry of seen.values()) {
      if (entry.count > 1) isUpdated.push(entry.record);
      else isNew.push(entry.record);
    }
    return { isNew, isUpdated };
  };

  const entities = collect("entities");
  const relations = collect("relations");
  return {
    newEntities: entities.isNew,
    updatedEntities: entities.isUpdated,
    newRelations: relations.isNew,
    updatedRelations: relations.isUpdated,
  };
}

/** 取实体/关系的稳定标识；缺少 id 时用类型与名称拼一个。 */
function readIdentity(
  record: Record<string, unknown>,
  index: number,
  key: "entities" | "relations",
): string {
  const id = record.id;
  if (typeof id === "string" && id) return id;
  const name = record.name ?? record.text ?? record.summary;
  const source = record.source;
  const target = record.target;
  const parts = [
    typeof name === "string" ? name : "",
    typeof source === "string" ? source : "",
    typeof target === "string" ? target : "",
    typeof record.type === "string" ? record.type : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("|") : `${key}-${index}`;
}

/** 读取记录里的字符串字段。 */
export function readRecordString(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}
