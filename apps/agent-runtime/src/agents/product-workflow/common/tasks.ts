/**
 * 任务排序工具
 *
 * 提供按 sequence 对 TaskExecutionNode 数组排序的函数，
 * 确保 Executor 按 DAG 的线性化顺序依次执行。
 *
 * Responsibilities:
 * - orderTasksBySequence()：按 sequence 升序排列任务节点
 */

import type { TaskExecutionNode } from "@repo/shared";

/**
 * 按 sequence 排序，确保 Executor 以 DAG 的线性化顺序执行。
 */
export function orderTasksBySequence(
  tasks: TaskExecutionNode[],
): TaskExecutionNode[] {
  return [...tasks].sort((left, right) => left.sequence - right.sequence);
}
