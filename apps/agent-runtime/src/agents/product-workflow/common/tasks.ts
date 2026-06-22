import type { TaskExecutionNode } from "@repo/shared";

/**
 * 按 sequence 排序，确保 Executor 以 DAG 的线性化顺序执行。
 */
export function orderTasksBySequence(
  tasks: TaskExecutionNode[],
): TaskExecutionNode[] {
  return [...tasks].sort((left, right) => left.sequence - right.sequence);
}
