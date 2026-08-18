/**
 * 产品工作流 DAG 查询工具
 *
 * 提供不修改状态的依赖查询与验证能力，供 Planner 裁剪、恢复和 Executor Router 复用。
 *
 * Responsibilities:
 * - 计算 ready task 与下游闭包
 * - 按 Executor 打包单批任务
 * - 检查未知依赖、自依赖和循环依赖
 */

import type { TaskExecutionNode, TaskExecutionPlan } from "@repo/shared";
import {
  isExecutorAgentType,
  type ExecutorAgentType,
} from "./executor-agent/definitions";

/** 计算种子任务及所有传递下游任务。 */
export function collectDownstreamTaskIds(
  plan: TaskExecutionPlan,
  initialTaskIds: ReadonlySet<string>,
): Set<string> {
  const affected = new Set(initialTaskIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of plan.tasks) {
      if (affected.has(task.task_id)) continue;
      if (task.depends_on.some((id) => affected.has(id))) {
        affected.add(task.task_id);
        changed = true;
      }
    }
  }
  return affected;
}

/** 根据已完成任务返回按 sequence 排序的 ready tasks。 */
export function selectReadyTasks(
  plan: TaskExecutionPlan,
  completedTaskIds: ReadonlySet<string>,
): TaskExecutionNode[] {
  return plan.tasks
    .filter((task) => !completedTaskIds.has(task.task_id))
    .filter((task) => task.depends_on.every((id) => completedTaskIds.has(id)))
    .sort((left, right) => left.sequence - right.sequence);
}

/** 同一批为每个 Executor 保留最早的 ready task。 */
export function packParallelExecutorTasks(
  tasks: readonly TaskExecutionNode[],
): TaskExecutionNode[] {
  const selected = new Map<ExecutorAgentType, TaskExecutionNode>();
  for (const task of [...tasks].sort((a, b) => a.sequence - b.sequence)) {
    if (!isExecutorAgentType(task.assigned_agent)) continue;
    if (!selected.has(task.assigned_agent)) selected.set(task.assigned_agent, task);
  }
  return [...selected.values()];
}

/** 返回 DAG 中可精确判断的依赖错误。 */
export function validateTaskDag(plan: TaskExecutionPlan): string[] {
  const ids = new Set(plan.tasks.map((task) => task.task_id));
  const issues: string[] = [];
  for (const task of plan.tasks) {
    for (const dependency of task.depends_on) {
      if (dependency === task.task_id) issues.push(`${task.task_id}:self_dependency`);
      else if (!ids.has(dependency)) issues.push(`${task.task_id}:unknown_dependency:${dependency}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(plan.tasks.map((task) => [task.task_id, task]));
  const visit = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    const cyclic = (byId.get(taskId)?.depends_on ?? []).some(
      (dependency) => byId.has(dependency) && visit(dependency),
    );
    visiting.delete(taskId);
    visited.add(taskId);
    return cyclic;
  };
  if (plan.tasks.some((task) => visit(task.task_id))) issues.push("cyclic_dependency");
  return [...new Set(issues)];
}
